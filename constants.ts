import { InstructionConfig, Level } from './types';

export const INSTRUCTION_SPECS: Record<string, InstructionConfig> = {
  LOAD: { type: 'LOAD', color: 'bg-blue-500', latency: 3, description: 'Load from memory to register', unit: 'MEM' },
  STORE: { type: 'STORE', color: 'bg-indigo-500', latency: 1, description: 'Store register to memory', unit: 'MEM' },
  ADD: { type: 'ADD', color: 'bg-green-500', latency: 1, description: 'Integer Addition', unit: 'ALU' },
  MUL: { type: 'MUL', color: 'bg-pink-500', latency: 2, description: 'Integer Multiplication', unit: 'ALU' },
  FMA: { type: 'FMA', color: 'bg-orange-500', latency: 3, description: 'Fused Multiply-Add', unit: 'ALU' },
  NOOP: { type: 'NOOP', color: 'bg-gray-700', latency: 1, description: 'No Operation', unit: 'ALU' },
};

export const LEVELS: Level[] = [
  {
    id: 'level-1',
    name: 'Vector Add',
    description: 'Compute R = A + B. Keep it tight!',
    targetCycles: 6,
    bestKnownCycles: 5,
    units: [
      { type: 'MEM', count: 1 },
      { type: 'ALU', count: 1 }
    ],
    instructions: [
      { id: '1', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'rA' },
      { id: '2', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'rB' },
      { id: '3', type: 'ADD', cycle: -1, unitIndex: -1, dependencies: ['1', '2'], variable: 'rRes' },
      { id: '4', type: 'STORE', cycle: -1, unitIndex: -1, dependencies: ['3'], variable: 'MEM' },
    ],
    requiredOutput: ['MEM']
  },
  {
    id: 'level-2',
    name: 'SAXPY',
    description: 'Single-Precision A*X + Y. The bread and butter of linear algebra.',
    targetCycles: 8,
    bestKnownCycles: 7,
    units: [
      { type: 'MEM', count: 1 },
      { type: 'ALU', count: 2 }
    ],
    instructions: [
      { id: '1', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'rX' },
      { id: '2', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'rY' },
      { id: '3', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'rA' },
      { id: '4', type: 'MUL', cycle: -1, unitIndex: -1, dependencies: ['1', '3'], variable: 'rAX' },
      { id: '5', type: 'ADD', cycle: -1, unitIndex: -1, dependencies: ['4', '2'], variable: 'rRes' },
      { id: '6', type: 'STORE', cycle: -1, unitIndex: -1, dependencies: ['5'], variable: 'MEM' },
    ],
    requiredOutput: ['MEM']
  },
  {
    id: 'level-3',
    name: 'Complex Mul',
    description: '(a+bi)(c+di) = (ac-bd) + (ad+bc)i. Optimization challenge!',
    targetCycles: 15,
    bestKnownCycles: 11,
    units: [
      { type: 'MEM', count: 2 },
      { type: 'ALU', count: 2 }
    ],
    instructions: [
      { id: 'L1', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'a' },
      { id: 'L2', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'b' },
      { id: 'L3', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'c' },
      { id: 'L4', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'd' },
      
      { id: 'M1', type: 'MUL', cycle: -1, unitIndex: -1, dependencies: ['L1', 'L3'], variable: 'ac' },
      { id: 'M2', type: 'MUL', cycle: -1, unitIndex: -1, dependencies: ['L2', 'L4'], variable: 'bd' },
      { id: 'M3', type: 'MUL', cycle: -1, unitIndex: -1, dependencies: ['L1', 'L4'], variable: 'ad' },
      { id: 'M4', type: 'MUL', cycle: -1, unitIndex: -1, dependencies: ['L2', 'L3'], variable: 'bc' },

      { id: 'A1', type: 'ADD', cycle: -1, unitIndex: -1, dependencies: ['M1', 'M2'], variable: 'real' }, 
      { id: 'A2', type: 'ADD', cycle: -1, unitIndex: -1, dependencies: ['M3', 'M4'], variable: 'imag' },

      { id: 'S1', type: 'STORE', cycle: -1, unitIndex: -1, dependencies: ['A1'], variable: 'MEM_R' },
      { id: 'S2', type: 'STORE', cycle: -1, unitIndex: -1, dependencies: ['A2'], variable: 'MEM_I' },
    ],
    requiredOutput: ['MEM_R', 'MEM_I']
  },
  {
    id: 'level-4',
    name: 'Loop Unrolling (2x)',
    description: 'Pipeline two iterations of Vector Add (A[i]+B[i]). Overlap the loads and stores!',
    targetCycles: 9,
    bestKnownCycles: 8,
    units: [
      { type: 'MEM', count: 2 },
      { type: 'ALU', count: 2 }
    ],
    instructions: [
      // Iteration 0
      { id: 'L1_0', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'A[0]' },
      { id: 'L2_0', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'B[0]' },
      { id: 'A1_0', type: 'ADD', cycle: -1, unitIndex: -1, dependencies: ['L1_0', 'L2_0'], variable: 'R[0]' },
      { id: 'S1_0', type: 'STORE', cycle: -1, unitIndex: -1, dependencies: ['A1_0'], variable: 'M[0]' },
      
      // Iteration 1
      { id: 'L1_1', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'A[1]' },
      { id: 'L2_1', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'B[1]' },
      { id: 'A1_1', type: 'ADD', cycle: -1, unitIndex: -1, dependencies: ['L1_1', 'L2_1'], variable: 'R[1]' },
      { id: 'S1_1', type: 'STORE', cycle: -1, unitIndex: -1, dependencies: ['A1_1'], variable: 'M[1]' },
    ],
    requiredOutput: ['M[0]', 'M[1]']
  },
  {
    id: 'level-5',
    name: 'Tiny GEMM (2x2 Tile)',
    description: 'Matrix-Vector (y=Ax). 1 MEM unit, 2 ALUs. You must maximize vector reuse to survive the memory bottleneck.',
    targetCycles: 18,
    bestKnownCycles: 14,
    units: [
      { type: 'MEM', count: 1 }, // Constrained memory bandwidth!
      { type: 'ALU', count: 2 }  // Plenty of compute
    ],
    instructions: [
       // --- PRELOAD VECTOR X ---
       // Reuse these for both rows!
       { id: 'Lx0', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'x[0]' },
       { id: 'Lx1', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'x[1]' },
       
       // --- ROW 0 (y[0] = A[0,0]x[0] + A[0,1]x[1]) ---
       { id: 'LA00', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'A[0,0]' },
       { id: 'M00', type: 'MUL', cycle: -1, unitIndex: -1, dependencies: ['LA00', 'Lx0'], variable: 'p00' },
       
       { id: 'LA01', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'A[0,1]' },
       { id: 'M01', type: 'MUL', cycle: -1, unitIndex: -1, dependencies: ['LA01', 'Lx1'], variable: 'p01' },
       
       { id: 'ADD0', type: 'ADD', cycle: -1, unitIndex: -1, dependencies: ['M00', 'M01'], variable: 'y[0]' },
       { id: 'S0', type: 'STORE', cycle: -1, unitIndex: -1, dependencies: ['ADD0'], variable: 'MEM_y0' },

       // --- ROW 1 (y[1] = A[1,0]x[0] + A[1,1]x[1]) ---
       // Notice we depend on Lx0 and Lx1 again -> REUSE
       { id: 'LA10', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'A[1,0]' },
       { id: 'M10', type: 'MUL', cycle: -1, unitIndex: -1, dependencies: ['LA10', 'Lx0'], variable: 'p10' },

       { id: 'LA11', type: 'LOAD', cycle: -1, unitIndex: -1, dependencies: [], variable: 'A[1,1]' },
       { id: 'M11', type: 'MUL', cycle: -1, unitIndex: -1, dependencies: ['LA11', 'Lx1'], variable: 'p11' },

       { id: 'ADD1', type: 'ADD', cycle: -1, unitIndex: -1, dependencies: ['M10', 'M11'], variable: 'y[1]' },
       { id: 'S1', type: 'STORE', cycle: -1, unitIndex: -1, dependencies: ['ADD1'], variable: 'MEM_y1' },
    ],
    requiredOutput: ['MEM_y0', 'MEM_y1']
  }
];