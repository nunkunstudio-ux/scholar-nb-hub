
import React, { useState, useEffect, useMemo, useRef } from 'react';
import SimulationCanvas from './components/SimulationCanvas';
import StatsDashboard from './components/StatsDashboard';
import { FlightParams, SimulationResults, WingType } from './types';
import { SEA_LEVEL_AIR_DENSITY, GRAVITY } from './constants';
import { getFlightAnalysis } from './services/geminiService';

const App: React.FC = () => {
  const [params, setParams] = useState<FlightParams>({
    weight: 575000,
    wingSpan: 79.75,
    chordLength: 10.6,
    velocity: 0, 
    headWind: 0,
    airDensity: SEA_LEVEL_AIR_DENSITY,
    angleOfAttack: 4,
    wingType: 'airbus',
  });

  const [altitude, setAltitude] = useState(0);
  const [distance, setDistance] = useState(0); // meters
  const [flightTime, setFlightTime] = useState(0); // seconds
  const [zoom, setZoom] = useState(1.0);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [autoThrottle, setAutoThrottle] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isSoundOn, setIsSoundOn] = useState(false);
  const [isAltHold, setIsAltHold] = useState(false);
  const [isLanding, setIsLanding] = useState(false);
  const [landingStatus, setLandingStatus] = useState<string>("");

  const MAX_VELOCITY = 650; 

  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    if (isSoundOn && !isPaused) {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        const bufferSize = 2 * audioContextRef.current.sampleRate;
        const noiseBuffer = audioContextRef.current.createBuffer(1, bufferSize, audioContextRef.current.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;

        const whiteNoise = audioContextRef.current.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;
        const gainNode = audioContextRef.current.createGain();
        const filterNode = audioContextRef.current.createBiquadFilter();
        filterNode.type = 'lowpass';
        whiteNoise.connect(filterNode);
        filterNode.connect(gainNode);
        gainNode.connect(audioContextRef.current.destination);
        whiteNoise.start();
        gainNodeRef.current = gainNode;
        filterNodeRef.current = filterNode;
      }
    } else {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    }
  }, [isSoundOn, isPaused]);

  useEffect(() => {
    if (gainNodeRef.current && filterNodeRef.current && audioContextRef.current) {
      const totalAirspeed = params.velocity + params.headWind;
      const normalizedVel = Math.min(1, totalAirspeed / MAX_VELOCITY);
      gainNodeRef.current.gain.setTargetAtTime(isPaused ? 0 : normalizedVel * 0.4, audioContextRef.current.currentTime, 0.1);
      filterNodeRef.current.frequency.setTargetAtTime(400 + (normalizedVel * 3000), audioContextRef.current.currentTime, 0.1);
    }
  }, [params.velocity, params.headWind, isPaused, MAX_VELOCITY]);

  const currentAirDensity = useMemo(() => {
    const lapseRate = 0.00008; 
    return Math.max(0.35, SEA_LEVEL_AIR_DENSITY - (altitude * lapseRate));
  }, [altitude]);

  const results = useMemo((): SimulationResults => {
    const s = params.wingSpan * params.chordLength;
    const aoaRad = (params.angleOfAttack * Math.PI) / 180;
    const totalAirspeed = params.velocity + params.headWind;
    
    let baseCl = 0.45;
    if (params.wingType === 'symmetric') baseCl = 0.0;
    if (params.wingType === 'flat-bottom') baseCl = 0.55;
    if (params.wingType === 'thin') baseCl = 0.15;
    if (params.wingType === 'stealth') baseCl = 0.12;

    let cl = 2 * Math.PI * aoaRad + baseCl; 
    if (params.angleOfAttack > 16) {
      const stallFactor = Math.max(0, 1 - (params.angleOfAttack - 16) * 0.2);
      cl *= stallFactor;
    }
    cl = Math.max(0, cl);

    const liftForce = 0.5 * currentAirDensity * Math.pow(totalAirspeed, 2) * s * cl;
    const weightForce = params.weight * GRAVITY;
    const requiredTakeoffSpeed = Math.sqrt((2 * weightForce) / (currentAirDensity * s * Math.max(0.1, cl))) - params.headWind;

    return {
      liftForce,
      dragForce: liftForce * (totalAirspeed > 250 ? 0.15 : 0.05),
      requiredTakeoffSpeed,
      isFlying: liftForce > weightForce && totalAirspeed > 25,
      pressureTop: -0.5 * currentAirDensity * (Math.pow(totalAirspeed * 1.2, 2) - Math.pow(totalAirspeed, 2)),
      pressureBottom: -0.5 * currentAirDensity * (Math.pow(totalAirspeed * 0.8, 2) - Math.pow(totalAirspeed, 2)),
      velocityTop: totalAirspeed * 1.2,
      velocityBottom: totalAirspeed * 0.8,
      altitude
    };
  }, [params, altitude, currentAirDensity]);

  useEffect(() => {
    let animationFrame: number;
    const loop = (time: number) => {
      if (!isPaused) {
        if (!lastTimeRef.current) lastTimeRef.current = time;
        const dt = (time - lastTimeRef.current) / 1000; // seconds
        lastTimeRef.current = time;

        const weightForce = params.weight * GRAVITY;
        const netForce = results.liftForce - weightForce;
        const massDamping = Math.max(10000, params.weight / 25); 
        const climbRate = netForce / massDamping; 
        
        // Update Altitude
        setAltitude(prev => {
          let next = prev + (climbRate * dt); 
          if (next <= 0) return 0;
          if (next >= 10000 && autoThrottle) return 10000; 
          return next;
        });

        // Update Ground Distance (m)
        setDistance(prev => prev + (params.velocity * dt));
        
        // Update Flight Time (only if moving or flying)
        if (params.velocity > 0 || results.isFlying) {
          setFlightTime(prev => prev + dt);
        }

        if (isAltHold && !isLanding && results.isFlying) {
          const totalAirspeed = params.velocity + params.headWind;
          if (totalAirspeed > 10) {
            const s = params.wingSpan * params.chordLength;
            const targetCl = weightForce / (0.5 * currentAirDensity * Math.pow(totalAirspeed, 2) * s);
            const targetAoADeg = ( (targetCl - (params.wingType === 'airbus' ? 0.45 : 0.2)) / (2 * Math.PI) ) * (180 / Math.PI);
            const clampedAoA = Math.min(15, Math.max(-5, targetAoADeg));
            setParams(prev => ({ ...prev, angleOfAttack: prev.angleOfAttack + (clampedAoA - prev.angleOfAttack) * 0.02 }));
          }
        }

        if (isLanding) {
          const targetApproachSpeed = 75; 
          const targetDescentRate = altitude > 50 ? -6 : -2; 
          
          setParams(prev => {
            let nextVel = prev.velocity;
            let nextAoA = prev.angleOfAttack;
            const currentVSI = (results.liftForce - weightForce) / massDamping;

            if (nextVel > targetApproachSpeed + 2) nextVel -= 0.4;
            else if (nextVel < targetApproachSpeed - 2) nextVel += 0.4;

            if (altitude > 15) {
                setLandingStatus("GLIDESLOPE INTERCEPT");
                const vsiError = targetDescentRate - currentVSI;
                nextAoA += vsiError * 0.08; 
            } else if (altitude > 0.5) {
                setLandingStatus("FLARE / REDUCE THRUST");
                nextAoA += (8.5 - nextAoA) * 0.1; 
                nextVel *= 0.99; 
            } else {
                setLandingStatus("TOUCHDOWN / BRAKING");
                nextAoA = 2; 
                nextVel = Math.max(0, nextVel - 2.5); 
                if (nextVel === 0) {
                   setIsLanding(false);
                   setLandingStatus("");
                }
            }
            return { ...prev, velocity: nextVel, angleOfAttack: Math.max(-2, Math.min(15, nextAoA)) };
          });
        }
      } else {
        lastTimeRef.current = 0;
      }
      animationFrame = requestAnimationFrame(loop);
    };
    animationFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrame);
  }, [results.liftForce, isAltHold, isLanding, results.isFlying, isPaused, params.velocity, params.weight, params.wingType, altitude, currentAirDensity, autoThrottle]);

  useEffect(() => {
    let interval: number;
    if (autoThrottle && !isPaused && !isLanding) {
      interval = window.setInterval(() => {
        const targetCruiseSpeed = 700 / 3.6; 
        const targetClimbAltitude = 10000;
        setParams(p => {
          let nextVel = p.velocity;
          let nextAoA = p.angleOfAttack;
          if (altitude < 50) {
            nextVel = Math.min(nextVel + 1.5, MAX_VELOCITY);
            if (results.isFlying) nextAoA = 12;
          } else if (altitude < targetClimbAltitude - 100) {
            if (nextVel < targetCruiseSpeed) nextVel += 1.0;
            nextAoA = 12;
            setIsAltHold(false);
          } else {
            nextVel += (targetCruiseSpeed - nextVel) * 0.1;
            setIsAltHold(true);
          }
          return { ...p, velocity: nextVel, angleOfAttack: nextAoA };
        });
      }, 50);
    }
    return () => clearInterval(interval);
  }, [autoThrottle, isPaused, isLanding, altitude, results.isFlying, MAX_VELOCITY]);

  const toggleLanding = () => {
    if (!results.isFlying && altitude <= 0) return;
    setIsLanding(!isLanding);
    if (isAltHold) setIsAltHold(false);
    if (autoThrottle) setAutoThrottle(false);
  };

  const toggleAutoV = () => {
    setAutoThrottle(!autoThrottle);
    if (isLanding) setIsLanding(false);
    if (!autoThrottle) setIsAltHold(false);
  };

  const resetStats = () => {
    setDistance(0);
    setFlightTime(0);
    setAltitude(0);
    setParams(prev => ({ ...prev, velocity: 0, angleOfAttack: 4 }));
    setIsLanding(false);
    setAutoThrottle(false);
    setIsAltHold(false);
    lastTimeRef.current = 0;
  };

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    const analysis = await getFlightAnalysis(params, results);
    setAiAnalysis(analysis);
    setIsAnalyzing(false);
  };

  // Helper to format seconds to HH:MM:SS
  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return [hours, minutes, seconds]
      .map(v => v < 10 ? "0" + v : v)
      .filter((v, i) => v !== "00" || i > 0)
      .join(":");
  };

  const wingProfiles: { id: WingType; label: string; icon: string; weight: number; span: number; chord: number }[] = [
    { id: 'airbus', label: 'Airbus A380 (Super Heavy)', icon: 'fa-plane-up', weight: 575000, span: 79.75, chord: 10.6 },
    { id: 'stealth', label: 'F-35 Lightning (Fighter)', icon: 'fa-mask', weight: 29900, span: 10.7, chord: 5.5 },
    { id: 'cambered', label: 'Cessna 172 (General)', icon: 'fa-plane', weight: 1111, span: 11.0, chord: 1.6 },
    { id: 'symmetric', label: 'Extra 300 (Aerobatic)', icon: 'fa-sync-alt', weight: 950, span: 7.5, chord: 1.4 },
    { id: 'flat-bottom', label: 'Piper Cub (Trainer)', icon: 'fa-box', weight: 550, span: 10.7, chord: 1.6 },
    { id: 'thin', label: 'F-16 Falcon (Supersonic)', icon: 'fa-bolt', weight: 12000, span: 9.96, chord: 3.5 },
  ];

  const currentVSI = (results.liftForce - params.weight * GRAVITY) / 10000;

  return (
    <div className="lg:h-screen bg-[#020617] text-slate-100 flex flex-col overflow-hidden">
      <header className="w-full bg-slate-900/95 backdrop-blur-lg z-50 border-b border-white/5 shadow-2xl shrink-0">
        <div className="max-w-[1920px] mx-auto px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-600/20 rounded-xl border border-blue-500/40">
              <i className="fas fa-wind text-blue-400 text-2xl"></i>
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-white leading-none mb-1">
                AeroPro <span className="text-blue-500">Mission v22</span>
              </h1>
              <p className="text-[10px] text-slate-500 uppercase font-black tracking-[0.3em]">
                Advanced Flight Analytics Engine
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-3 items-center">
            <button onClick={resetStats} className="p-3 rounded-xl text-sm bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition-all">
              <i className="fas fa-redo-alt mr-2"></i> RESET
            </button>
            <button onClick={() => setIsSoundOn(!isSoundOn)} className={`p-3 rounded-xl text-lg transition-all border ${isSoundOn ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
              <i className={`fas ${isSoundOn ? 'fa-volume-up' : 'fa-volume-mute'}`}></i>
            </button>
            <button onClick={() => setIsPaused(!isPaused)} className={`px-5 py-3 rounded-xl text-sm font-black transition-all border flex items-center gap-2 ${isPaused ? 'bg-amber-600 border-amber-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-200'}`}>
              <i className={`fas ${isPaused ? 'fa-play' : 'fa-pause'}`}></i>
              {isPaused ? 'RESUME' : 'FREEZE'}
            </button>
            <button 
              onClick={toggleLanding} 
              disabled={!results.isFlying && altitude <= 0}
              className={`px-5 py-3 rounded-xl text-sm font-black transition-all border flex items-center gap-2 ${isLanding ? 'bg-red-600 border-red-400 text-white animate-pulse' : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'}`}
            >
              <i className="fas fa-plane-arrival"></i>
              {isLanding ? landingStatus : 'AUTO LAND'}
            </button>
            <button onClick={toggleAutoV} className={`px-5 py-3 rounded-xl text-sm font-black transition-all border flex items-center gap-2 ${autoThrottle ? 'bg-emerald-600 border-emerald-400 text-white animate-pulse' : 'bg-slate-800 border-slate-700 text-slate-200'}`}>
              <i className="fas fa-plane-departure"></i>
              {autoThrottle ? (altitude >= 9999 ? 'STABLE CRUISE' : 'CLIMBING TO 10K') : 'AUTO MISSION'}
            </button>
            <button onClick={runAnalysis} disabled={isAnalyzing} className="px-5 py-3 rounded-xl text-sm font-black bg-blue-600 hover:bg-blue-500 transition-all flex items-center gap-2 border border-blue-400/30 shadow-lg shadow-blue-500/20">
              {isAnalyzing ? <i className="fas fa-sync fa-spin"></i> : <i className="fas fa-brain"></i>}
              AI ANALYZE
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1920px] mx-auto w-full flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-0">
        <section className="lg:col-span-8 flex flex-col bg-slate-950 relative overflow-hidden border-r border-white/5">
          <SimulationCanvas params={params} results={results} isSimulating={!isPaused} zoom={zoom} />
          
          <div className="absolute top-6 left-6 flex flex-col gap-2 pointer-events-none">
            <div className="bg-slate-900/90 backdrop-blur-md p-4 rounded-2xl border border-white/10 flex flex-col items-center shadow-2xl">
               <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">VSI (m/s)</span>
               <div className={`text-xl font-black font-mono ${currentVSI > 0.1 ? 'text-green-400' : currentVSI < -0.1 ? 'text-red-400' : 'text-slate-400'}`}>
                  {currentVSI > 0 ? '+' : ''}{currentVSI.toFixed(1)}
               </div>
            </div>
          </div>

          <div className="absolute bottom-6 left-6 flex flex-col gap-3 pointer-events-none">
             <div className={`px-6 py-3 rounded-2xl font-black text-sm tracking-widest uppercase transition-all duration-500 flex items-center gap-3 border ${results.isFlying ? 'bg-green-500/20 text-green-400 border-green-500/30 shadow-[0_0_30px_rgba(34,197,94,0.1)]' : 'bg-red-500/10 text-red-500 border-red-500/30'}`}>
                <div className={`w-2 h-2 rounded-full ${results.isFlying ? 'bg-green-500 animate-ping' : 'bg-red-500'}`}></div>
                {results.isFlying ? 'Airborne' : 'Grounded'}
             </div>
          </div>

          {/* HUD Indicators: Distance, Time, Altitude */}
          <div className="absolute bottom-6 right-6 flex flex-row gap-4">
            <div className="bg-slate-900/95 backdrop-blur-xl px-6 py-4 rounded-3xl border border-emerald-500/20 shadow-2xl flex flex-col items-center min-w-[140px] relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500/50"></div>
              <span className="text-[9px] font-black text-emerald-500/60 uppercase tracking-[0.2em] mb-1">DISTANCE</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-emerald-400 font-mono tracking-tighter">{(distance / 1000).toFixed(2)}</span>
                <span className="text-[10px] font-black text-emerald-600 uppercase">KM</span>
              </div>
            </div>

            <div className="bg-slate-900/95 backdrop-blur-xl px-6 py-4 rounded-3xl border border-amber-500/20 shadow-2xl flex flex-col items-center min-w-[140px] relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-amber-500/50"></div>
              <span className="text-[9px] font-black text-amber-500/60 uppercase tracking-[0.2em] mb-1">FLIGHT TIME</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-amber-400 font-mono tracking-tighter">{formatTime(flightTime)}</span>
              </div>
            </div>

            <div className="bg-slate-900/95 backdrop-blur-xl px-6 py-4 rounded-3xl border border-blue-500/20 shadow-2xl flex flex-col items-center min-w-[140px] relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-blue-500/50"></div>
              <span className="text-[9px] font-black text-blue-500/60 uppercase tracking-[0.2em] mb-1">ALTITUDE</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-blue-400 font-mono tracking-tighter">{altitude.toFixed(0)}</span>
                <span className="text-[10px] font-black text-blue-600 uppercase">M</span>
              </div>
            </div>
          </div>
        </section>

        <section className="lg:col-span-4 bg-slate-900/40 p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6 shadow-2xl">
          <div className="bg-slate-900/80 p-6 rounded-[32px] border border-white/10 shadow-xl flex flex-col gap-6">
            <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 flex items-center gap-3">
              <i className="fas fa-sliders-h text-blue-500"></i> Cockpit Management
            </h3>
            
            <div className="space-y-6">
              <div className="space-y-3 p-4 bg-slate-950/40 rounded-2xl border border-white/5">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-black text-slate-400 uppercase">Camera Viewport Zoom</span>
                  <span className="text-xs font-black text-blue-400">{(zoom * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min="0.1" max="2.0" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer accent-blue-500" />
              </div>

              <div className="space-y-3">
                <span className="text-xs font-black text-slate-400 uppercase">Wing Profile Configuration</span>
                <div className="grid grid-cols-2 gap-2">
                  {wingProfiles.map((wp) => (
                    <button key={wp.id} onClick={() => setParams({
                        ...params,
                        wingType: wp.id,
                        weight: wp.weight,
                        wingSpan: wp.span,
                        chordLength: wp.chord
                      })} 
                      className={`p-3 rounded-xl border text-[11px] font-black flex items-center gap-3 transition-all ${params.wingType === wp.id ? 'bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-500/30' : 'bg-slate-800/50 border-white/5 text-slate-400 hover:bg-slate-800'}`}>
                      <i className={`fas ${wp.icon}`}></i> {wp.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <span className="text-xs font-black text-slate-400 uppercase">Engine Power (G-Speed)</span>
                  <div className="text-xl font-black text-indigo-400 font-mono leading-none">{(params.velocity * 3.6).toFixed(0)} <span className="text-[10px]">km/h</span></div>
                </div>
                <input type="range" min="0" max={MAX_VELOCITY} step="0.1" value={params.velocity} disabled={isLanding || autoThrottle} onChange={(e) => setParams({...params, velocity: Number(e.target.value)})} className={`w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer accent-indigo-500 ${(isLanding || autoThrottle) ? 'opacity-30' : ''}`} />
              </div>

              <div className="space-y-3 p-4 bg-emerald-950/20 rounded-2xl border border-emerald-500/10">
                <div className="flex justify-between items-end">
                  <span className="text-xs font-black text-emerald-400 uppercase">Natural Headwind (V-Wind)</span>
                  <div className="text-xl font-black text-emerald-400 font-mono leading-none">{(params.headWind * 3.6).toFixed(1)} <span className="text-[10px]">km/h</span></div>
                </div>
                <input type="range" min="0" max="100" step="0.5" value={params.headWind} onChange={(e) => setParams({...params, headWind: Number(e.target.value)})} className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer accent-emerald-500" />
              </div>

              <div className="space-y-3 p-4 bg-slate-950/40 rounded-2xl border border-white/5 shadow-inner">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-black text-slate-400 uppercase">Angle of Attack (AoA)</span>
                  <button onClick={() => setIsAltHold(!isAltHold)} disabled={isLanding || autoThrottle} className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all border flex items-center gap-2 ${isAltHold ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                    <i className={`fas ${isAltHold ? 'fa-lock' : 'fa-unlock'}`}></i>
                    {isAltHold ? 'HOLD ON' : 'HOLD OFF'}
                  </button>
                </div>
                <div className="flex justify-between items-end mb-2">
                  <span className={`text-3xl font-black font-mono transition-colors duration-300 ${(isAltHold || isLanding || autoThrottle) ? 'text-blue-400' : 'text-indigo-400'}`}>
                    {params.angleOfAttack.toFixed(2)}°
                  </span>
                  {(isAltHold || isLanding || autoThrottle) && <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping"></div><span className="text-[8px] text-blue-400 font-black uppercase">AP SYNC</span></div>}
                </div>
                <input type="range" min="-5" max="25" step="0.01" value={params.angleOfAttack} disabled={isAltHold || isLanding || autoThrottle} onChange={(e) => setParams({...params, angleOfAttack: Number(e.target.value)})} className={`w-full h-3 bg-slate-800 rounded-full appearance-none cursor-pointer accent-blue-500 transition-all ${(isAltHold || isLanding || autoThrottle) ? 'opacity-20 cursor-not-allowed' : 'opacity-100 hover:accent-indigo-400'}`} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-950/60 p-3 rounded-2xl border border-white/5">
                  <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-1">Weight (KG)</label>
                  <input type="number" value={params.weight} onChange={(e) => setParams({...params, weight: Number(e.target.value)})} className="w-full bg-transparent font-black text-sm text-white outline-none" />
                </div>
                <div className="bg-slate-950/60 p-3 rounded-2xl border border-white/5">
                  <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-1">Span (M)</label>
                  <input type="number" value={params.wingSpan} onChange={(e) => setParams({...params, wingSpan: Number(e.target.value)})} className="w-full bg-transparent font-black text-sm text-white outline-none" />
                </div>
                <div className="bg-slate-950/60 p-3 rounded-2xl border border-white/5">
                  <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-1">Chord (M)</label>
                  <input type="number" value={params.chordLength} onChange={(e) => setParams({...params, chordLength: Number(e.target.value)})} className="w-full bg-transparent font-black text-sm text-white outline-none" />
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1">
            <StatsDashboard results={results} params={params} />
          </div>

          <div className="bg-blue-600/5 p-5 rounded-3xl border border-blue-500/10 text-[11px] text-slate-400 leading-relaxed font-medium">
             <h4 className="text-blue-400 font-black uppercase mb-2"><i className="fas fa-graduation-cap mr-2"></i> สรุปข้อมูล v22:</h4>
             <ul className="space-y-1 list-disc list-inside">
               <li>**Auto-Spec**: ระบบเปลี่ยนน้ำหนักและขนาดปีกอัตโนมัติตามประเภทเครื่องบิน (A380, F-35, Cessna ฯลฯ)</li>
               <li>**Full Control**: ปรับแต่งน้ำหนัก, Wing Span และ Chord Length ได้อิสระหลังเลือก Preset</li>
               <li>**Ground Distance Tracker**: บันทึกระยะทางที่เคลื่อนที่ได้จริงเทียบกับพื้นดิน (หน่วย KM)</li>
             </ul>
          </div>
        </section>
      </main>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #334155; }
      `}</style>
    </div>
  );
};

export default App;
