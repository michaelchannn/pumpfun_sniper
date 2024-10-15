import {
  PublicKey,
  Connection,
  Logs,
  ParsedTransactionWithMeta,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Idl } from "@project-serum/anchor";
import * as anchor from "@project-serum/anchor";
import idl from "./pump_fun_idl.json";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";

// PumpFun program ID
const programId = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

// Private key for keypair generation
const userPrivateKeyBase58 = "PRIVATE_KEY";
const userPrivateKey = bs58.decode(userPrivateKeyBase58);
const userKeypair = Keypair.fromSecretKey(userPrivateKey);

// Buying Constants
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMP_GLOBAL = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
const PUMP_EVENT_AUTHORITY = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
const PUMP_FEE = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
const SYSTEM_PROGRAM = SystemProgram.programId;
const SYSTEM_RENT = SYSVAR_RENT_PUBKEY;
const LAMPORTS_PER_SOL = 1_000_000_000;

// Helius RPC endpoint to make connection
const connection = new Connection(
  "HELIUS_API_KEY"
);

// User-specified folder path for logs
const logFolderPath = "/Users/Logs"; // Replace with your desired folder path

// Ensure the log directory exists
if (!fs.existsSync(logFolderPath)) {
  fs.mkdirSync(logFolderPath, { recursive: true });
}

// log file paths
const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); 
const logFileName = `transaction_logs_${timestamp}.csv`;
const logFilePath = path.join(logFolderPath, logFileName);

// Function to escape and quote CSV fields
const escapeCSV = (field: string): string => {
  if (field.includes('"')) {
    field = field.replace(/"/g, '""'); // Escape existing double quotes
  }
  return `"${field}"`; // Enclose the field in double quotes
};


// Function to create compute unit price instructions with varying priority fees
const createComputeUnitPriceInstructions = (numVariations: number, basePrice: number): TransactionInstruction[] => {
  const instructions: TransactionInstruction[] = [];
  for (let i = 0; i < numVariations; i++) {
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: basePrice + i * 1000
    });
    instructions.push(computePriceIx);
  }
  return instructions;
};

// Function to spam buy transactions with varying priority fees
const spamBuyTransactions = async (
  mintAddress: string,
  bondCurveAddress: string,
  associatedBondCurveAddress: string,
  numSpams: number,
  basePrice: number
): Promise<string[]> => {
  const computeInstructions = createComputeUnitPriceInstructions(numSpams, basePrice);
  const buySignatures: string[] = [];

  for (const computeIx of computeInstructions) {
    try {
      const transaction = new Transaction().add(computeIx);

      // Derive associated token account for user
      const associatedTokenAccount = await getAssociatedTokenAddress(
        new PublicKey(mintAddress),
        userKeypair.publicKey
      );

      // Create associated token account instruction
      const createATAIx = createAssociatedTokenAccountInstruction(
        userKeypair.publicKey,
        associatedTokenAccount,
        userKeypair.publicKey,
        new PublicKey(mintAddress)
      );

      transaction.add(createATAIx);

      // Set maxSolCost to 0.0001 SOL in lamports
      const maxSolCost = 0.0001 * LAMPORTS_PER_SOL;

      // Set amount to a large number scaled for 6 decimals, max price per token = 3 * 10^-8
      const maxPricePerTokenLamports = 0.00000003 * LAMPORTS_PER_SOL;
      const tokensToBuy = Math.floor(maxSolCost / maxPricePerTokenLamports);
      const amount = new anchor.BN(tokensToBuy * 1e6);

      // Encode instruction data using the imported IDL
      const instructionCoder = new anchor.BorshInstructionCoder(idl as Idl);
      const data = instructionCoder.encode("buy", {
        amount: amount,
        maxSolCost: new anchor.BN(maxSolCost),
      });

      // Create the buy instruction
      const buyInstruction = new TransactionInstruction({
        keys: [
          { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
          { pubkey: PUMP_FEE, isSigner: false, isWritable: true },
          { pubkey: new PublicKey(mintAddress), isSigner: false, isWritable: false },
          { pubkey: new PublicKey(bondCurveAddress), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(associatedBondCurveAddress), isSigner: false, isWritable: true },
          { pubkey: associatedTokenAccount, isSigner: false, isWritable: true },
          { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSTEM_RENT, isSigner: false, isWritable: false },
          { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
          { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
        ],
        programId: programId,
        data: data,
      });

      transaction.add(buyInstruction);

      // Send the transaction
      const signature = await connection.sendTransaction(transaction, [userKeypair], { skipPreflight: true });
      console.log(`Buy Transaction sent: ${signature}`);
      buySignatures.push(signature);
    } catch (error) {
      console.error("Failed to send buy transaction:", error);
    }
  }

  return buySignatures;
};

// Function to spam sell transactions with varying priority fees
const spamSellTransactions = async (
  mintAddress: string,
  bondCurveAddress: string,
  associatedBondCurveAddress: string,
  numSpams: number,
  basePrice: number
): Promise<string[]> => {
  const computeInstructions = createComputeUnitPriceInstructions(numSpams, basePrice);
  const sellSignatures: string[] = [];

  // Calculate the fixed number of tokens to sell (same as in buy function)
  const maxSolCost = 0.0001 * LAMPORTS_PER_SOL;
  const maxPricePerTokenLamports = 0.00000003 * LAMPORTS_PER_SOL;
  const tokensToSell = Math.floor(maxSolCost / maxPricePerTokenLamports);

  for (const computeIx of computeInstructions) {
    try {
      const transaction = new Transaction().add(computeIx);

      // Encode instruction data for sell
      const instructionCoder = new anchor.BorshInstructionCoder(idl as Idl);
      const sellData = instructionCoder.encode("sell", {
        amount: new anchor.BN(tokensToSell * 1e6),
        minSolOutput: new anchor.BN(0), // Accept any amount of SOL
      });

      // Derive associated token account for user
      const associatedTokenAccount = await getAssociatedTokenAddress(
        new PublicKey(mintAddress),
        userKeypair.publicKey
      );

      // Create the sell instruction
      const sellInstruction = new TransactionInstruction({
        keys: [
          { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
          { pubkey: PUMP_FEE, isSigner: false, isWritable: true },
          { pubkey: new PublicKey(mintAddress), isSigner: false, isWritable: false },
          { pubkey: new PublicKey(bondCurveAddress), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(associatedBondCurveAddress), isSigner: false, isWritable: true },
          { pubkey: associatedTokenAccount, isSigner: false, isWritable: true },
          { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
          { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
        ],
        programId: programId,
        data: sellData,
      });

      transaction.add(sellInstruction);

      // Send the sell transaction
      const signature = await connection.sendTransaction(transaction, [userKeypair], { skipPreflight: true });
      console.log(`Sell Transaction sent: ${signature}`);
      sellSignatures.push(signature);
    } catch (error) {
      console.error("Failed to send sell transaction:", error);
    }
  }

  return sellSignatures;
};

// Function to aggressively fetch a transaction
const aggressivelyGetTransaction = async (
  signature: string,
  maxAttempts: number = 1000
): Promise<ParsedTransactionWithMeta | null> => {
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;
    try {
      const tx = await connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (tx !== null) {
        console.log(`Transaction found after ${attempts} attempts.`);
        return tx;
      }

      if (attempts % 100 === 0) {
        console.log(
          `Attempt ${attempts}: Transaction not available yet. Continuing...`
        );
      }
    } catch (error) {
      console.error(`Error fetching transaction on attempt ${attempts}:`, error);
    }
  }

  console.error(`Failed to fetch transaction after ${maxAttempts} attempts.`);
  return null;
};

// Function to write logs to a CSV file
const logTransactionToCSV = (
  logFilePath: string, 
  mintAddress: string,
  buyTransactionLinks: string,
  sellTransactionLinks: string,
  latencyMintToDetection: number,
  latencyDetectionToRetrieval: number,
  latencyRetrievalToBuyStart: number,
  totalBuyLatency: number,
  latencyBuySpam: number,
  latencySellSpam: number
) => {
  const headers = 'Mint Address,Buy Transaction Links,Sell Transaction Links,Mint to Detection Latency (ms),Detection to Retrieval Latency (ms),Retrieval to Buy Start Latency (ms),Total Buy Latency (ms),Buy Spam Duration (ms),Sell Spam Duration (ms)\n';
  
  // Check if the log file exists; if not, write headers
  if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, headers, { flag: 'w' });
  }

  // Escape and quote the necessary fields
  const escapedMintAddress = escapeCSV(mintAddress);
  const escapedBuyLinks = escapeCSV(buyTransactionLinks);
  const escapedSellLinks = escapeCSV(sellTransactionLinks);
  
  // Create the log entry
  const logEntry = `${escapedMintAddress},${escapedBuyLinks},${escapedSellLinks},${latencyMintToDetection},${latencyDetectionToRetrieval},${latencyRetrievalToBuyStart},${totalBuyLatency},${latencyBuySpam},${latencySellSpam}\n`;
  
  // Append the log entry
  fs.appendFileSync(logFilePath, logEntry, { flag: 'a' });
};

// Main function to start monitoring
const startMonitoringPumpFun = async (): Promise<void> => {
  try {
    connection.onLogs(
      programId,
      async (logs: Logs) => {
        try {
          if (
            logs.logs &&
            logs.logs.some((log: string) =>
              log.includes("Program log: Instruction: InitializeMint2")
            )
          ) {
            const detectedTime = Date.now();
            console.log("Log signature:", logs.signature);

            const tx = await aggressivelyGetTransaction(logs.signature);

            if (tx) {
              const mintTime = tx.blockTime ? tx.blockTime * 1000 : null;
              const mintAddress = tx.transaction?.message?.accountKeys?.[1]?.pubkey?.toBase58();
              const bondCurveAddress = tx.transaction?.message?.accountKeys?.[3]?.pubkey?.toBase58();
              const associatedBondCurveAddress = tx.transaction?.message?.accountKeys?.[4]?.pubkey?.toBase58();
              const mintRetrievalTime = Date.now();

              const mintRetrievalLatency = mintTime ? mintRetrievalTime - mintTime : null;

              if (
                mintTime &&
                mintAddress &&
                bondCurveAddress &&
                associatedBondCurveAddress &&
                mintRetrievalLatency !== null &&
                mintRetrievalLatency < 1500
              ) {
                console.log(`Latency from mint to retrieval: ${mintRetrievalLatency}ms`);
                console.log(`Spamming buy transactions...`);

                const buyStartTime = Date.now();
                const buySignatures = await spamBuyTransactions(mintAddress, bondCurveAddress, associatedBondCurveAddress, 5, 1000);
                const buyEndTime = Date.now();

                console.log(`Buy transactions sent. Waiting 2 seconds before selling...`);
                await new Promise(resolve => setTimeout(resolve, 2000));

                console.log(`Spamming sell transactions...`);
                const sellStartTime = Date.now();
                const sellSignatures = await spamSellTransactions(mintAddress, bondCurveAddress, associatedBondCurveAddress, 5, 1000);
                const sellEndTime = Date.now();

                // Calculate latencies
                const latencyMintToDetection = detectedTime - mintTime;
                const latencyDetectionToRetrieval = mintRetrievalTime - detectedTime;
                const latencyRetrievalToBuyStart = buyStartTime - mintRetrievalTime;
                const totalBuyLatency = buyStartTime - mintTime; // Total time from mint to buy start
                const latencyBuySpam = buyEndTime - buyStartTime;
                const latencySellSpam = sellEndTime - sellStartTime;

                // Construct Solscan links
                const buyTransactionLinks = buySignatures.map(sig => `https://solscan.io/tx/${sig}`).join('; ');
                const sellTransactionLinks = sellSignatures.map(sig => `https://solscan.io/tx/${sig}`).join('; ');

                // Log the transactions and latencies
                logTransactionToCSV(
                  logFilePath,
                  mintAddress,
                  buyTransactionLinks,
                  sellTransactionLinks,
                  latencyMintToDetection,
                  latencyDetectionToRetrieval,
                  latencyRetrievalToBuyStart,
                  totalBuyLatency,
                  latencyBuySpam,
                  latencySellSpam
                );

                console.log(`Total buy latency: ${totalBuyLatency}ms`);
                console.log(`Buy spam duration: ${latencyBuySpam}ms`);
                console.log(`Sell spam duration: ${latencySellSpam}ms`);
              } else {
                console.log(`Latency too high (${mintRetrievalLatency}ms). Skipping transactions.`);
              }
            } else {
              console.log("Failed to retrieve transaction data after maximum attempts.");
            }
          }
        } catch (error) {
          console.error("Error processing log:", error);
        }
      },
      "processed"
    );

    console.log("Monitoring PumpFun program for new mints...");
  } catch (error) {
    console.error("Error setting up log listener:", error);
  }
};

// Start monitoring
startMonitoringPumpFun();
