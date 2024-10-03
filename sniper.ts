import {
    Connection,
    PublicKey,
    Keypair,
    LAMPORTS_PER_SOL,
  } from "@solana/web3.js";
  import { PumpFunSDK, PriorityFee } from "pumpdotfun-sdk";
  import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
  import bs58 from "bs58";
  import { getMint } from "@solana/spl-token";
  
  // Create a Keypair from private key
  const userPrivateKey = bs58.decode(
    "PRIVATE_KEY_HERE" 
  );
  const userKeypair = Keypair.fromSecretKey(new Uint8Array(userPrivateKey));
  const userPublicKey = userKeypair.publicKey.toBase58();
  const wallet = new Wallet(userKeypair);
  console.log("Public Key:", userPublicKey);
  
  // Connecting to Solana mainnet via Helius RPC
  const connection = new Connection(
    "HELIUS_API_KEY_HERE" 
  );
  
  // Create Provider instance
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "processed", //to maximize speed
  });
  
  // Create PumpFun SDK instance
  const sdk = new PumpFunSDK(provider);
  
  // Constants
  const BUY_AMOUNT = 2_000_000n; // Amount in lamports (0.002 SOL)
  const SLIPPAGE = 200n; // Slippage in basis points
  const TAKE_PROFIT_PERCENTAGE = 20; // 20% profit
  const STOP_LOSS_PERCENTAGE = 10; // 10% loss
  
  // Define the priority fee (0.002 SOL)
  const PRIORITY_FEE: PriorityFee = {
    unitLimit: 1_000_000, // Compute units
    unitPrice: 2, // Lamports per unit
  };
  
  // Interface for tokens being traded
  interface TradedToken {
    mintAddress: string;
    buyPrice: number;      // Price at which the token was bought (in SOL per token)
    amountBought: bigint;  // Amount of tokens bought
  }
  
  // List to keep track of tokens being traded
  let tradedTokens: TradedToken[] = [];
  
  // Function to start monitoring for new token mints using event listener
  const startMonitoringTokenMints = () => {
    const createEventListenerId = sdk.addEventListener(
      "createEvent",
      async (event) => {
        console.log("Create Event Detected");
        const mintPublicKey = event.mint; 
        const mintAddress = mintPublicKey.toBase58();
        console.log("Mint Address:", mintAddress);
  
        // Buy the token immediately
        await buyToken(mintAddress);
      }
    );
  
    console.log("Create Event Listener ID:", createEventListenerId);
  };
  
  // Function to buy a token
  async function buyToken(mintAddress: string) {
    try {
      const mintPublicKey = new PublicKey(mintAddress);
  
      // Attempt to buy the token
      const txResult = await sdk.buy(
        userKeypair,
        mintPublicKey,
        BUY_AMOUNT,
        SLIPPAGE,
        PRIORITY_FEE
      );
      console.log(
        `Successfully bought token ${mintAddress}. Transaction Result:`,
        txResult
      );
  
      // Extract the transaction signature
      const txId = txResult.signature;
  
      if (!txId) {
        console.error('Transaction signature not found in txResult.');
        return;
      }
  
      // Wait for the transaction to be confirmed
      await connection.confirmTransaction(txId, "finalized");
  
      // Fetch the transaction details to determine the amount of tokens received
      const transaction = await connection.getParsedTransaction(txId, {
        maxSupportedTransactionVersion: 0,
        commitment: "finalized",
      });
  
      if (!transaction) {
        console.error(`Failed to fetch transaction details for ${txId}`);
        return;
      }
  
      // Determine the amount of tokens received
      const amountBought = await getAmountBoughtFromTransaction(
        transaction,
        mintPublicKey,
        userPublicKey
      );
  
      if (amountBought === null) {
        console.error(`Failed to determine amount bought for ${mintAddress}`);
        return;
      }
  
      // Get the buy price per token
      const buyPrice = await getTokenPrice(sdk, connection, mintPublicKey);
  
      if (buyPrice !== null) {
        // Add the token to the tradedTokens list with the amount bought
        tradedTokens.push({
          mintAddress,
          buyPrice,
          amountBought,
        });
  
        console.log(
          `Monitoring token ${mintAddress} for profit/loss targets.`
        );
      } else {
        console.log(`Could not retrieve price for token ${mintAddress}.`);
      }
    } catch (error) {
      console.error(`Error buying token ${mintAddress}:`, error);
    }
  }
  
  // Function to determine the amount of tokens bought from the transaction
  async function getAmountBoughtFromTransaction(
    transaction: any,
    mintPublicKey: PublicKey,
    userPublicKey: string
  ): Promise<bigint | null> {
    try {
      const preTokenBalances = transaction.meta?.preTokenBalances || [];
      const postTokenBalances = transaction.meta?.postTokenBalances || [];
  
      // Find the token balance entries for the mint and user
      const preBalanceEntry = preTokenBalances.find(
        (balance: any) =>
          balance.mint === mintPublicKey.toBase58() &&
          balance.owner === userPublicKey
      );
      const postBalanceEntry = postTokenBalances.find(
        (balance: any) =>
          balance.mint === mintPublicKey.toBase58() &&
          balance.owner === userPublicKey
      );
  
      const preBalance = BigInt(preBalanceEntry?.uiTokenAmount.amount || "0");
      const postBalance = BigInt(postBalanceEntry?.uiTokenAmount.amount || "0");
  
      const amountBought = postBalance - preBalance;
  
      if (amountBought <= 0n) {
        console.error("Amount bought is zero or negative.");
        return null;
      }
  
      return amountBought;
    } catch (error) {
      console.error("Error parsing transaction for amount bought:", error);
      return null;
    }
  }
  
  // Function to get token decimals
  async function getTokenDecimals(
    connection: Connection,
    mintPublicKey: PublicKey
  ): Promise<number | null> {
    try {
      const mintInfo = await getMint(connection, mintPublicKey);
      return mintInfo.decimals;
    } catch (error) {
      console.error(
        `Error getting decimals for token ${mintPublicKey.toBase58()}:`,
        error
      );
      return null;
    }
  }
  
  // Function to get the current price of a token in SOL per token using getSellPrice
  async function getTokenPrice(
    sdk: PumpFunSDK,
    connection: Connection,
    mintPublicKey: PublicKey
  ): Promise<number | null> {
    try {
      // Get token decimals
      const decimals = await getTokenDecimals(connection, mintPublicKey);
      if (decimals === null) {
        console.log(
          `Could not retrieve decimals for token ${mintPublicKey.toBase58()}.`
        );
        return null;
      }
  
      // Define the amount to sell (e.g., 1 token unit adjusted for decimals)
      const amountToSell = BigInt(1 * 10 ** decimals);
  
      // Fetch the bonding curve account
      const bondingCurveAccount = await sdk.getBondingCurveAccount(mintPublicKey);
  
      if (!bondingCurveAccount) {
        console.error("Bonding curve account not found.");
        return null;
      }
  
      // Calculate the sell price using getSellPrice
      const feeBasisPoints = 0n; // No fee for price calculation
      const solReceived = bondingCurveAccount.getSellPrice(
        amountToSell,
        feeBasisPoints
      );
  
      // Convert lamports to SOL and calculate price per token
      const priceInSOL = Number(solReceived) / LAMPORTS_PER_SOL / Number(amountToSell);
  
      // Adjust price back to per whole token
      const pricePerToken = priceInSOL * 10 ** decimals;
  
      return pricePerToken;
    } catch (error) {
      console.error(
        `Error getting price for token ${mintPublicKey.toBase58()}:`,
        error
      );
      return null;
    }
  }
  
  // Function to sell a token
  async function sellToken(token: TradedToken) {
    try {
      const mintPublicKey = new PublicKey(token.mintAddress);
  
      const txResult = await sdk.sell(
        userKeypair,
        mintPublicKey,
        token.amountBought, // Sell the amount bought
        SLIPPAGE,
        PRIORITY_FEE
      );
      console.log(
        `Successfully sold token ${token.mintAddress}. Transaction Result:`,
        txResult
      );
  
      // Remove the token from tradedTokens
      tradedTokens = tradedTokens.filter(
        (t) => t.mintAddress !== token.mintAddress
      );
    } catch (error) {
      console.error(`Error selling token ${token.mintAddress}:`, error);
    }
  }
  
  // Function to check the price of a token and decide whether to sell
  async function checkTokenPrice(token: TradedToken) {
    const mintPublicKey = new PublicKey(token.mintAddress);
    const currentPrice = await getTokenPrice(sdk, connection, mintPublicKey);
  
    if (currentPrice !== null) {
      const priceChangePercentage =
        ((currentPrice - token.buyPrice) / token.buyPrice) * 100;
  
      console.log(
        `Token ${token.mintAddress}: Buy Price = ${token.buyPrice.toFixed(
          6
        )} SOL, Current Price = ${currentPrice.toFixed(
          6
        )} SOL, Change = ${priceChangePercentage.toFixed(2)}%`
      );
  
      if (priceChangePercentage >= TAKE_PROFIT_PERCENTAGE) {
        console.log(
          `Token ${token.mintAddress} reached take profit target. Selling...`
        );
        // Sell the token
        await sellToken(token);
      } else if (priceChangePercentage <= -STOP_LOSS_PERCENTAGE) {
        console.log(
          `Token ${token.mintAddress} reached stop loss target. Selling...`
        );
        // Sell the token
        await sellToken(token);
      }
    }
  }
  
  // Function to monitor tokens for profit/loss targets
  function monitorTokens() {
    setInterval(async () => {
      const tokensToMonitor = [...tradedTokens];
      const numTokens = tokensToMonitor.length;
  
      if (numTokens === 0) {
        // No tokens to monitor, skip this iteration
        return;
      }
  
      // Calculate the minimum interval per token to stay within rate limits
      const maxRpcRequestsPerSecond = 8; // Using 8 for safety margin
      const intervalPerToken = 1000 / maxRpcRequestsPerSecond; // in milliseconds
  
      for (const token of tokensToMonitor) {
        await checkTokenPrice(token);
        // Wait for intervalPerToken milliseconds before checking the next token
        await new Promise((resolve) => setTimeout(resolve, intervalPerToken));
      }
    }, 0); // Start immediately without a fixed interval
  }
  
  // Start monitoring tokens
  monitorTokens();
  
  // Start monitoring for token mints
  startMonitoringTokenMints();
  