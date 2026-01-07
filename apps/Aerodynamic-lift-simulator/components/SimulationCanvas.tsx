
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FlightParams, SimulationResults, Particle } from '../types';
import { GRAVITY } from '../constants';

interface MistParticle extends Particle {
  px: number; 
  py: number; 
  speedMultiplier: number;
}

interface Props {
  params: FlightParams;
  results: SimulationResults;
  isSimulating: boolean;
  zoom: number; // New Prop
}

const SimulationCanvas: React.FC<Props> = ({ params, results, isSimulating, zoom }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<MistParticle[]>([]);
  const requestRef = useRef<number | null>(null);

  const initParticles = useCallback(() => {
    const newParticles: MistParticle[] = [];
    const count = 2500; // Increased density for zoom
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 1600;
      const y = Math.random() * 1000;
      newParticles.push({
        x,
        y,
        px: x,
        py: y,
        vx: 0,
        vy: 0,
        life: Math.random() * 100,
        opacity: 0.1 + Math.random() * 0.4,
        speedMultiplier: 0.9 + Math.random() * 0.2 
      });
    }
    particlesRef.current = newParticles;
  }, []);

  useEffect(() => {
    initParticles();
  }, [initParticles]);

  const drawAirfoilPath = (ctx: CanvasRenderingContext2D, length: number) => {
    const type = params.wingType;
    ctx.beginPath();
    ctx.moveTo(-length / 2, 0);

    if (type === 'symmetric') {
      ctx.bezierCurveTo(-length / 4, -length / 4, length / 4, -length / 4, length / 2, 0);
      ctx.bezierCurveTo(length / 4, length / 4, -length / 4, length / 4, -length / 2, 0);
    } else if (type === 'flat-bottom') {
      ctx.bezierCurveTo(-length / 4, -length / 3, length / 4, -length / 3, length / 2, 0);
      ctx.lineTo(-length / 2, 0);
    } else if (type === 'thin') {
      ctx.bezierCurveTo(-length / 4, -length / 8, length / 4, -length / 8, length / 2, 0);
      ctx.bezierCurveTo(length / 4, length / 8, -length / 4, length / 8, -length / 2, 0);
    } else if (type === 'airbus') {
      ctx.bezierCurveTo(-length / 4, -length / 5, length / 8, -length / 6, length / 2, 0);
      ctx.bezierCurveTo(length / 4, length / 6, 0, length / 8, -length / 2, 0);
    } else if (type === 'stealth') {
      // F-35 Style Angular diamond shape
      ctx.lineTo(-length / 8, -length / 10);
      ctx.lineTo(length / 4, -length / 12);
      ctx.lineTo(length / 2, 0);
      ctx.lineTo(length / 4, length / 12);
      ctx.lineTo(-length / 8, length / 10);
      ctx.lineTo(-length / 2, 0);
    } else {
      ctx.bezierCurveTo(-length / 4, -length / 3.2, length / 4, -length / 3.2, length / 2, 0);
      ctx.bezierCurveTo(length / 4, length / 10, -length / 4, length / 10, -length / 2, 0);
    }
    ctx.closePath();
  };

  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const groundY = height - 120;
    const totalAirspeed = params.velocity + params.headWind;
    
    ctx.fillStyle = '#010418';
    ctx.fillRect(0, 0, width, height);

    // Grids with Zoom
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.08)';
    ctx.lineWidth = 1;
    const step = 100 * zoom;
    for (let y = 0; y < height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    for (let x = 0; x < width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }

    const visualAltOffset = Math.min(height * 0.4, results.altitude / 10);
    const centerX = width * 0.5;
    const centerY = (groundY - 50) - visualAltOffset; 
    
    // Automatic scaling of the wing based on chord length AND manual zoom
    // We want the wing to be visible even if it's 10m long.
    const baseScale = 250 / Math.max(1, params.chordLength / 2); 
    const wingLength = params.chordLength * baseScale * zoom; 
    const aoaRad = (params.angleOfAttack * Math.PI) / 180;

    const baseFlowVel = -( (totalAirspeed / 3.5) + 2 ) * zoom; 

    particlesRef.current.forEach(p => {
      if (isSimulating) {
        p.px = p.x;
        p.py = p.y;

        let targetVx = baseFlowVel * p.speedMultiplier;
        let targetVy = 0;

        const dx = p.x - centerX;
        const dy = p.y - centerY;
        
        const cosA = Math.cos(-aoaRad);
        const sinA = Math.sin(-aoaRad);
        const lx = dx * cosA - dy * sinA;
        const ly = dx * sinA + dy * cosA;

        const influenceRadius = wingLength * 1.5;

        if (Math.abs(lx) < influenceRadius && Math.abs(ly) < influenceRadius * 0.4) {
          const xFactor = 1 - Math.abs(lx) / influenceRadius;
          const yDistNormalized = Math.abs(ly) / (influenceRadius * 0.4);
          const yFactor = Math.pow(1 - yDistNormalized, 1.5);
          const totalInfluence = xFactor * yFactor;

          const wingType = params.wingType;
          let liftPull = 0;
          let curveFollow = 0;

          if (ly < 0) { // TOP
            liftPull = (totalAirspeed / 2.0) * (1 + (params.angleOfAttack / 18)) * zoom;
            targetVy += 14 * totalInfluence * zoom;
            const curvature = (wingType === 'flat-bottom' || wingType === 'cambered' || wingType === 'airbus') ? 30 : 15;
            curveFollow = Math.sin((lx / (wingLength/2)) * Math.PI / 1.7) * curvature * zoom;
          } else { // BOTTOM
            liftPull = -(totalAirspeed / 7.5) * zoom; 
            curveFollow = (wingType === 'symmetric') ? -8 : 6;
            curveFollow *= zoom;
          }

          targetVx -= liftPull * totalInfluence;
          targetVy += curveFollow * totalInfluence;
          targetVy += (params.angleOfAttack * 3.0) * totalInfluence * zoom;

          if (params.angleOfAttack > 16 && ly < -5) {
            targetVy += (Math.random() - 0.5) * (params.angleOfAttack - 15) * 10 * zoom;
            targetVx *= 0.5; 
          }
        }

        p.x += targetVx;
        p.y += targetVy;

        if (p.x < -100) {
          p.x = width + 100; p.px = width + 100;
          p.y = Math.random() * height; p.py = p.y;
        }
      }

      const flowSpeed = Math.abs(p.x - p.px);
      const alpha = Math.min(0.75, p.opacity * (flowSpeed / (5 * zoom) + 0.3));
      
      ctx.beginPath();
      ctx.strokeStyle = `rgba(180, 225, 255, ${alpha})`;
      ctx.lineWidth = 1.3 * zoom;
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });

    // Wing Drawing
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(-1, 1); 
    ctx.rotate(-aoaRad);

    if (isSimulating && params.angleOfAttack > 16) {
      const jitter = (params.angleOfAttack - 16) * 2 * zoom;
      ctx.translate(Math.random() * jitter - jitter/2, Math.random() * jitter - jitter/2);
    }

    ctx.shadowBlur = 50 * zoom;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';

    drawAirfoilPath(ctx, wingLength);
    
    const pressureGradient = ctx.createLinearGradient(0, -60 * zoom, 0, 40 * zoom);
    const pNorm = Math.min(1, Math.abs(results.pressureBottom - results.pressureTop) / 12000);
    
    if (results.isFlying) {
      pressureGradient.addColorStop(0, `rgba(59, 130, 246, ${0.85 + pNorm * 0.15})`); 
      pressureGradient.addColorStop(1, `rgba(239, 68, 68, ${0.85 + pNorm * 0.15})`); 
    } else {
      pressureGradient.addColorStop(0, '#334155');
      pressureGradient.addColorStop(1, '#475569');
    }
    
    ctx.fillStyle = pressureGradient; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4 * zoom; ctx.stroke();
    ctx.restore();

    // HUD Text
    if (totalAirspeed >= 0) {
      ctx.textAlign = 'center';
      
      const topLabelY = centerY - (180 * zoom);
      ctx.font = `bold ${24 * zoom}px monospace`;
      ctx.fillStyle = 'rgba(191, 219, 254, 1)';
      ctx.fillText(`FAST: ${(results.velocityTop * 3.6).toFixed(1)} km/h`, centerX, topLabelY - (45 * zoom));
      
      ctx.font = `black ${52 * zoom}px Sarabun`;
      ctx.fillStyle = '#60a5fa';
      ctx.shadowBlur = 15; ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.fillText(`${results.pressureTop.toFixed(0)} Pa`, centerX, topLabelY + (5 * zoom));
      ctx.shadowBlur = 0;

      const botLabelY = centerY + (160 * zoom);
      ctx.font = `bold ${24 * zoom}px monospace`;
      ctx.fillStyle = 'rgba(254, 202, 202, 1)';
      ctx.fillText(`SLOW: ${(results.velocityBottom * 3.6).toFixed(1)} km/h`, centerX, botLabelY + (55 * zoom));
      
      ctx.font = `black ${52 * zoom}px Sarabun`;
      ctx.fillStyle = '#f87171';
      ctx.shadowBlur = 15; ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.fillText(`${results.pressureBottom.toFixed(0)} Pa`, centerX, botLabelY);
      ctx.shadowBlur = 0;
    }

    const hudX = 30;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.96)';
    ctx.beginPath(); ctx.roundRect(hudX, 30, 290, 110, 20); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.fillStyle = '#fff'; ctx.font = 'black 16px Sarabun'; ctx.textAlign = 'left';
    ctx.fillText('Aerodynamic Engine 18.0', hudX + 20, 55);
    ctx.font = 'bold 13px Sarabun'; ctx.fillStyle = '#94a3b8';
    ctx.fillText(`AIRSPEED: ${(totalAirspeed * 3.6).toFixed(1)} km/h`, hudX + 20, 80);
    ctx.fillText(`ZOOM: ${(zoom * 100).toFixed(0)}%`, hudX + 20, 105);

    requestRef.current = requestAnimationFrame(() => draw(ctx));
  }, [params, results, isSimulating, zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) requestRef.current = requestAnimationFrame(() => draw(ctx));
    }
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [draw]);

  return (
    <div className="w-full h-full relative">
      <canvas ref={canvasRef} width={1600} height={1000} className="w-full h-full object-cover" />
      <div className="absolute top-6 right-6 flex flex-col items-end gap-2 pointer-events-none">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] bg-slate-950/90 p-3 rounded-2xl border border-white/10 shadow-2xl">
          Profile: {params.wingType.toUpperCase()}
        </span>
        <div className="flex gap-2 items-center bg-blue-500/15 px-4 py-2 rounded-full border border-blue-500/30">
          <i className="fas fa-search-plus text-[10px] text-blue-400"></i>
          <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Zoom View Active</span>
        </div>
      </div>
    </div>
  );
};

export default SimulationCanvas;
