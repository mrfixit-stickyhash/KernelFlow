import { GoogleGenAI } from "@google/genai";
import { Level, GameInstruction, SimulationResult } from '../types';

export const getOptimizationAdvice = async (
  level: Level,
  currentInstructions: GameInstruction[],
  simulation: SimulationResult,
  userMessage?: string
): Promise<string> => {
  
  // 1. Safe API Key Extraction
  let apiKey = '';
  try {
    // Prevent crash if process is not defined in browser environment
    apiKey = process.env.API_KEY || '';
  } catch (e) {
    console.warn("Environment variable access failed", e);
  }

  // 2. Graceful Fallback if Key is Missing
  if (!apiKey) {
    return "SYSTEM OFFLINE: AI Co-Pilot requires a valid API_KEY. Please check your environment configuration.";
  }

  try {
    // 3. Initialize Client Lazily (Only when needed)
    const ai = new GoogleGenAI({ apiKey });

    const placedInstructions = currentInstructions.filter(i => i.cycle >= 0);
    const unplacedCount = currentInstructions.length - placedInstructions.length;

    const boardState = placedInstructions.map(i => 
      `ID:${i.id} Type:${i.type} StartCycle:${i.cycle} Unit:${i.unitIndex} DependsOn:[${i.dependencies.join(',')}] Var:${i.variable}`
    ).join('\n');

    const hazards = simulation.hazards.map(h => `Cycle ${h.cycle}: ${h.reason} (${h.type})`).join('\n');

    const prompt = `
      You are an expert compiler engineer and kernel optimization coach in a game called "KernelFlow".
      
      Level: ${level.name}
      Description: ${level.description}
      Target Cycles: ${level.targetCycles}
      Hardware Units: ${level.units.map((u, i) => `Unit Row ${i} (${u.type})`).join(', ')}

      Current Board State:
      ${boardState || "No instructions placed yet."}

      Unplaced Instructions: ${unplacedCount}

      Simulation Status:
      Valid: ${simulation.valid}
      Current Total Cycles: ${simulation.totalCycles}
      Hazards/Stalls:
      ${hazards || "None"}

      User Query: ${userMessage || "Please analyze my schedule and give me a hint on how to optimize or fix hazards."}

      Provide concise, tactical advice. Focus on:
      1. Reducing hazards (dependency violations).
      2. Filling pipeline bubbles (gaps).
      3. Instruction Level Parallelism (ILP).
      
      Keep it under 3 sentences unless detailed explanation is requested.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    
    return response.text || "I couldn't generate a response. Try again.";

  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error communicating with the optimization core. Check console for details.";
  }
};