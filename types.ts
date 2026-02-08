export type InstructionType = 'LOAD' | 'STORE' | 'ADD' | 'MUL' | 'FMA' | 'NOOP';

export interface InstructionConfig {
  type: InstructionType;
  color: string;
  latency: number;
  description: string;
  unit: 'ALU' | 'MEM';
}

export interface GameInstruction {
  id: string;
  type: InstructionType;
  cycle: number; // The starting cycle (time)
  unitIndex: number; // Which execution unit (row)
  dependencies: string[]; // IDs of instructions this one depends on
  variable: string; // The variable name being written (e.g., 'r1')
}

export interface Level {
  id: string;
  name: string;
  description: string;
  targetCycles: number;
  units: { type: 'ALU' | 'MEM', count: number }[]; // Available hardware
  instructions: GameInstruction[]; // Initial unordered instructions
  requiredOutput: string[]; // Variable names that must be finalized
  bestKnownCycles?: number;
}

export interface Hazard {
  cycle: number;
  reason: string;
  instructionId?: string;
  type: 'RAW' | 'STRUCTURAL' | 'UNIT' | 'WAW';
}

export interface SimulationResult {
  valid: boolean;
  totalCycles: number;
  hazards: Hazard[];
  registerUsage: number;
  score: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}
