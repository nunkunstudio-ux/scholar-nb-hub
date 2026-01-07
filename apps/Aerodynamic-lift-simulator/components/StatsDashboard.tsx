
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { SimulationResults, FlightParams } from '../types';

interface Props {
  results: SimulationResults;
  params: FlightParams;
}

const StatsDashboard: React.FC<Props> = ({ results, params }) => {
  const generateChartData = () => {
    const data = [];
    const maxV = 650; 
    for (let v = 0; v <= maxV; v += 50) {
      const s = params.wingSpan * params.chordLength;
      const aoaRad = (params.angleOfAttack * Math.PI) / 180;
      let baseCl = 0.45;
      if (params.wingType === 'symmetric') baseCl = 0.0;
      if (params.wingType === 'flat-bottom') baseCl = 0.55;
      if (params.wingType === 'thin') baseCl = 0.15;
      if (params.wingType === 'stealth') baseCl = 0.12;

      let cl = 2 * Math.PI * aoaRad + baseCl;
      if (params.angleOfAttack > 16) {
        cl *= Math.max(0, 1 - (params.angleOfAttack - 16) * 0.15);
      }
      const lift = 0.5 * params.airDensity * Math.pow(v + params.headWind, 2) * s * Math.max(0, cl);
      data.push({ 
        speed: Math.round(v * 3.6), 
        lift: Math.round(lift),
      });
    }
    return data;
  };

  const chartData = generateChartData();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-950/40 p-4 rounded-2xl border border-white/5 flex flex-col items-center justify-center text-center shadow-lg">
          <span className="text-slate-500 text-[9px] uppercase font-black tracking-widest mb-1">Takeoff V (GS)</span>
          <span className="text-xl font-black text-blue-400 leading-none">
            {Math.max(0, results.requiredTakeoffSpeed * 3.6).toFixed(0)}
          </span>
          <p className="text-[9px] text-slate-500 font-bold font-mono">km/h</p>
        </div>

        <div className="bg-slate-950/40 p-4 rounded-2xl border border-white/5 flex flex-col items-center justify-center text-center shadow-lg">
          <span className="text-slate-500 text-[9px] uppercase font-black tracking-widest mb-1">Load Factor</span>
          <span className={`text-xl font-black leading-none ${results.isFlying ? 'text-green-400' : 'text-amber-500'}`}>
            {(results.liftForce / (params.weight * 9.81)).toFixed(2)}
          </span>
          <p className="text-[9px] text-slate-500 font-bold uppercase">{results.isFlying ? 'Airborne' : 'Grounded'}</p>
        </div>

        <div className="bg-slate-950/40 p-4 rounded-2xl border border-white/5 flex flex-col items-center justify-center text-center shadow-lg">
          <span className="text-slate-500 text-[9px] uppercase font-black tracking-widest mb-1">LIFT FORCE</span>
          <span className="text-xl font-black text-indigo-400 leading-none">
            {(results.liftForce / 1000).toFixed(0)}
          </span>
          <p className="text-[9px] text-slate-500 font-bold font-mono">kN</p>
        </div>
      </div>

      <div className="h-[200px] bg-slate-950/30 p-4 rounded-2xl border border-white/5 flex flex-col overflow-hidden">
        <h4 className="text-[9px] text-slate-500 mb-2 font-black uppercase tracking-[0.2em]">
          <i className="fas fa-chart-line text-blue-500 mr-2"></i> Lift Profile (N vs km/h)
        </h4>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="speed" hide />
              <YAxis stroke="#475569" fontSize={9} fontWeight="bold" tick={{ fill: '#475569' }} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '10px', fontSize: '10px' }}
                cursor={{ stroke: '#3b82f6', strokeWidth: 1 }}
              />
              <Area type="monotone" dataKey="lift" stroke="#3b82f6" strokeWidth={2} fill="url(#chartGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default StatsDashboard;
