// Import packages 
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
  "HELIUS_ENDPOINT"
);

// User-specified folder path for logs
const logFolderPath = '/Users/Logs'; // Replace with your desired folder path

// log file paths
const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); 
const logFileName = `transaction_logs_${timestamp}.csv`;
const logFilePath = path.join(logFolderPath, logFileName);

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
const logTransaction = (
  logFilePath: string, 
  mintAddress: string,
  buyTransactionLink: string,
  sellTransactionLink: string,
  latencyMintToDetection: number,
  latencyDetectionToRetrieval: number,
  latencyRetrievalToSend: number,
  totalBuyLatency: number,
  latencyBuyToSell: number,
  totalLatency: number
) => {
  const headers = 'Mint Address,Buy Transaction Link,Sell Transaction Link,Mint to Detection Latency (ms),Detection to Retrieval Latency (ms),Retrieval to Send (Buy) Latency (ms),Total Buy Latency (ms),Latency Buy to Sell (ms),Total Latency (ms)\n';
  const logEntry = `${mintAddress},${buyTransactionLink},${sellTransactionLink},${latencyMintToDetection},${latencyDetectionToRetrieval},${latencyRetrievalToSend},${totalBuyLatency},${latencyBuyToSell},${totalLatency}\n`;
  
  // Check if file exists
  if (!fs.existsSync(logFilePath)) { // Create the file and write the headers
    fs.writeFileSync(logFilePath, headers);
  }

  fs.appendFileSync(logFilePath, logEntry); // Append the log entry to the file
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
              log.includes("Program log: Instruction: InitializeMint2") // Check if log includes token mint instruction
            )
          ) {
            const detectedTime = Date.now();
            console.log("Log signature:", logs.signature);

            const tx = await aggressivelyGetTransaction(logs.signature);

            if (tx) { // Retrieving necessary addresses from tx
              const mintTime = tx.blockTime ? tx.blockTime * 1000 : null; // Convert to milliseconds
              const mintAddress =
                tx.transaction?.message?.accountKeys?.[1]?.pubkey?.toBase58();
              const bondCurveAddress =
                tx.transaction?.message?.accountKeys?.[3]?.pubkey?.toBase58();
              const associatedBondCurveAddress =
                tx.transaction?.message?.accountKeys?.[4]?.pubkey?.toBase58();
              const mintRetrievalTime = Date.now();

              // Calculate the latency from mint to retrieval
              const mintRetrievalLatency = mintTime ? mintRetrievalTime - mintTime : null;

              // Check if latency is within acceptable range
              if (
                mintTime &&
                mintAddress &&
                bondCurveAddress &&
                associatedBondCurveAddress &&
                mintRetrievalLatency !== null &&
                mintRetrievalLatency < 1500 // 1500 milliseconds threshold
              ) {
                console.log(`Latency from mint to retrieval: ${mintRetrievalLatency}ms`);
                console.log(`Attempting to buy token...`);

                try {
                  // Create the transaction
                  const transaction = new Transaction();

                  // Derive the associated token account for the user
                  const associatedTokenAccount = await getAssociatedTokenAddress(
                    new PublicKey(mintAddress),
                    userKeypair.publicKey
                  );

                  // Creating associated token account
                  console.log("Creating associated token account...");
                  const createATAIx = createAssociatedTokenAccountInstruction(
                    userKeypair.publicKey,        // payer
                    associatedTokenAccount,       // associated token account to create
                    userKeypair.publicKey,        // owner of the account
                    new PublicKey(mintAddress)    // mint
                  );
                  transaction.add(createATAIx);

                  // Set maxSolCost to 0.0001 SOL in lamports
                  const maxSolCost = 0.0001 * LAMPORTS_PER_SOL; // 0.0001 SOL in lamports

                  // Set amount to a large number scaled for 6 decimals, max price per token = 3 * 10^-8
                  const maxPricePerTokenLamports = 0.00000003 * LAMPORTS_PER_SOL;
                  const tokensToBuy = Math.floor(maxSolCost / maxPricePerTokenLamports);
                  const amount = new anchor.BN(tokensToBuy * 1e6); // If price is higher, transaction will fail due to slippage

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


                  // Send the buy transaction
                  const sendBuyTime = Date.now();
                  const buySignature = await connection.sendTransaction(
                    transaction,
                    [userKeypair],
                    {skipPreflight: true, maxRetries: 6}
                  );

                  console.log(`Buy Transaction sent: ${buySignature}`);
                  const buyTransactionLink = `https://solscan.io/tx/${buySignature}`;
                  console.log(buyTransactionLink);

                  // Proceed to send the sell transaction immediately after the buy transaction
                  console.log("Attempting to sell tokens...");

                  // Create the sell transaction
                  const sellTransaction = new Transaction();

                  // Encode instruction data for sell
                  const sellData = instructionCoder.encode("sell", {
                    amount: amount, // Sell the same amount as bought
                    minSolOutput: new anchor.BN(0), // Accept any amount of SOL
                  });

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

                  sellTransaction.add(sellInstruction);

                  // Send the sell transaction
                  const sendSellTime = Date.now();
                  const sellSignature = await connection.sendTransaction(
                    sellTransaction,
                    [userKeypair],
                    {skipPreflight: true, maxRetries: 6}
                  );

                  console.log(`Sell Transaction sent: ${sellSignature}`);
                  const sellTransactionLink = `https://solscan.io/tx/${sellSignature}`;
                  console.log(sellTransactionLink);

                  // Compute latencies
                  const latencyMintToDetection = detectedTime - mintTime;
                  const latencyDetectionToRetrieval = mintRetrievalTime - detectedTime;
                  const latencyRetrievalToSend = sendBuyTime - mintRetrievalTime;
                  const totalBuyLatency = sendBuyTime - mintTime;
                  const latencyBuyToSell = sendSellTime - sendBuyTime;
                  const totalLatency = sendSellTime - mintTime;

                  // Log the latencies
                  console.log(`Mint to Detection Latency: ${latencyMintToDetection}ms`);
                  console.log(`Detection to Retrieval Latency: ${latencyDetectionToRetrieval}ms`);
                  console.log(`Retrieval to Send (Buy) Latency: ${latencyRetrievalToSend}ms`);
                  console.log(`Total Buy Latency: ${totalBuyLatency}ms`);
                  console.log(`Latency Buy to Sell: ${latencyBuyToSell}ms`);
                  console.log(`Total Latency: ${totalLatency}ms`);

                  // Log the transactions with latencies 
                  logTransaction(
                    logFilePath, 
                    mintAddress,
                    buyTransactionLink,
                    sellTransactionLink,
                    latencyMintToDetection,
                    latencyDetectionToRetrieval,
                    latencyRetrievalToSend,
                    totalBuyLatency,
                    latencyBuyToSell,
                    totalLatency
                  );

                } catch (error) {
                  console.error("Failed to send transactions:", error);
                }
              } else {
                console.log(
                  `Latency too high (${mintRetrievalLatency}ms). Skipping buy.`
                );
              }
            } else {
              console.log(
                "Failed to retrieve transaction data after maximum attempts."
              );
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
