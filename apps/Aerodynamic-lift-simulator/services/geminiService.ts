
import { GoogleGenAI } from "@google/genai";
import { FlightParams, SimulationResults } from "../types";

const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const getFlightAnalysis = async (params: FlightParams, results: SimulationResults) => {
  const model = 'gemini-3-flash-preview';
  
  const prompt = `
    ในฐานะวิศวกรการบิน (Aeronautical Engineer) โปรดวิเคราะห์ข้อมูลการจำลองการบินดังนี้:
    
    พารามิเตอร์การออกแบบ:
    - น้ำหนักเครื่องบิน: ${params.weight} กิโลกรัม
    - ความกว้างปีก (Wing Span): ${params.wingSpan} เมตร
    - ความยาวคอร์ดปีก (Chord): ${params.chordLength} เมตร
    - ความเร็วปัจจุบัน: ${params.velocity} m/s
    - มุมปะทะ (AoA): ${params.angleOfAttack} องศา
    
    ผลลัพธ์จากการคำนวณ:
    - แรงยก (Lift): ${results.liftForce.toFixed(2)} N
    - ความเร็วที่ต้องการในการยกตัว: ${results.requiredTakeoffSpeed.toFixed(2)} m/s
    - สถานะการบิน: ${results.isFlying ? 'กำลังบิน' : 'ยังไม่สามารถยกตัวได้'}
    - ความดันอากาศด้านบน: ${results.pressureTop.toFixed(2)} Pa
    - ความดันอากาศด้านล่าง: ${results.pressureBottom.toFixed(2)} Pa
    
    โปรดสรุปและวิเคราะห์:
    1. ประสิทธิภาพของปีกชุดนี้ตามหลักอากาศพลศาสตร์
    2. คำแนะนำในการปรับปรุง (เช่น ปรับ AoA หรือความยาวปีก)
    3. คำอธิบายสั้นๆ เกี่ยวกับปรากฏการณ์ Bernoulli ที่เกิดขึ้นในกรณีนี้
    
    ให้ตอบในรูปแบบ Markdown ภาษาไทยเชิงวิชาการ ใช้ Emoji ประกอบได้
  `;

  try {
    const response = await genAI.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.7,
        topP: 0.95,
      }
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "ไม่สามารถดึงข้อมูลการวิเคราะห์จาก AI ได้ในขณะนี้";
  }
};
