
export type WingType = 'symmetric' | 'cambered' | 'flat-bottom' | 'thin' | 'airbus' | 'stealth';

export interface FlightParams {
  weight: number;      // kg
  wingSpan: number;    // meters
  chordLength: number; // meters
  velocity: number;    // Aircraft Ground Speed (m/s)
  headWind: number;    // Natural Headwind (m/s)
  airDensity: number;  // kg/m^3
  angleOfAttack: number; // degrees
  wingType: WingType;   // ประเภทของปีก
}

export interface SimulationResults {
  liftForce: number;
  dragForce: number;
  requiredTakeoffSpeed: number;
  isFlying: boolean;
  pressureTop: number;
  pressureBottom: number;
  velocityTop: number;
  velocityBottom: number;
  altitude: number;    // meters
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  opacity: number;
}
