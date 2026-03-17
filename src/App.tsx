/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Heart, 
  User, 
  ClipboardCheck, 
  FileText, 
  Activity, 
  Thermometer, 
  Droplets, 
  Stethoscope,
  ChevronRight,
  Plus,
  LogOut,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowLeft,
  Settings,
  Mic,
  Video,
  MessageSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  updateDoc,
  getDoc,
  setDoc,
  getDocs,
  limit,
  Timestamp,
  serverTimestamp
} from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { auth, db } from './firebase';

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface UserProfile {
  phoneNumber: string;
  role: 'nurse' | 'family';
  name?: string;
}

interface Patient {
  id: string;
  name: string;
  bedNumber: string;
  type: 'transplant' | 'lvad';
  status: 'green' | 'yellow' | 'red';
  lastUpdate?: any;
}

interface NurseUpdate {
  id: string;
  patientId: string;
  timestamp: any;
  tags: {
    vitalSigns: 'stable' | 'monitoring' | 'critical';
    temperature: 'low' | 'normal' | 'fever_low' | 'fever_high';
    bloodPressure: 'normal' | 'low' | 'high';
    heartRate: 'normal' | 'slow' | 'fast';
    oxygen: 'normal' | 'low';
    lvadStatus: 'normal' | 'alarm' | 'off';
    intubation: { status: 'normal' | 'extubated' | 'new', detail: string };
    drainage: { status: 'normal' | 'extubated' | 'new', detail: string };
    urinaryCatheter: { status: 'normal' | 'extubated' | 'new', detail: string };
    diet: 'npo' | 'liquid' | 'soft' | 'normal';
    activity: 'bed' | 'sit' | 'stand' | 'walk';
    sleep: 'good' | 'fair' | 'poor';
    mainProblem: string;
    transplantSpecific: {
      rejectionSigns: 'none' | 'mild' | 'moderate' | 'severe';
      immunosuppressant: 'target' | 'low' | 'high';
    };
    lvadSpecific: {
      pumpSpeed: string;
      pumpFlow: string;
      pumpPower: string;
      drivelineSite: string;
    };
  };
  needs: string[];
}

interface Message {
  id: string;
  senderId: string;
  senderRole: string;
  type: 'text' | 'voice';
  content?: string;
  audioUrl?: string;
  timestamp: any;
}

interface DailyReport {
  id: string;
  patientId: string;
  timestamp: any;
  content: string;
  status: 'green' | 'yellow' | 'red';
}

// --- AI Service ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

async function generateReport(update: NurseUpdate, patient: Patient) {
  const model = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: `你是一位在心外科ICU工作多年的资深护士，擅长用温情、通俗且专业的语言与家属沟通。
你的任务是将护士勾选的医疗标签翻译成一份给家属的“康复日报”。
要求：
1. 语气温和、充满希望，但保持客观。
2. 避免使用晦涩的医疗术语（如：NPO翻译为“暂时禁食”，Extubation翻译为“成功拔除气管插管”）。
3. 结构清晰：基础状态、治疗进展、生活关切。
4. 字数在200字左右。
5. 针对心外科移植或LVAD术后背景。`,
    },
    contents: `患者姓名：${patient.name}
患者类型：${patient.type === 'transplant' ? '心脏移植' : '左心室辅助 (LVAD)'}
数据标签：
- 生命体征：${update.tags.vitalSigns}
- 体温：${update.tags.temperature === 'normal' ? '正常' : update.tags.temperature === 'low' ? '低体温' : update.tags.temperature === 'fever_low' ? '低烧' : '高烧'}
- 血压：${update.tags.bloodPressure === 'normal' ? '正常' : update.tags.bloodPressure === 'low' ? '偏低' : '偏高'}
- 心率：${update.tags.heartRate === 'normal' ? '正常' : update.tags.heartRate === 'slow' ? '偏慢' : '偏快'}
- 氧合：${update.tags.oxygen === 'normal' ? '正常' : '偏低'}
${patient.type === 'lvad' ? `- LVAD状态：${update.tags.lvadStatus}
- 泵速：${update.tags.lvadSpecific?.pumpSpeed || '未记录'}
- 流量：${update.tags.lvadSpecific?.pumpFlow || '未记录'}
- 功率：${update.tags.lvadSpecific?.pumpPower || '未记录'}
- 泵缆出口：${update.tags.lvadSpecific?.drivelineSite || '未记录'}` : `- 排异迹象：${update.tags.transplantSpecific?.rejectionSigns || '无'}
- 免疫抑制剂浓度：${update.tags.transplantSpecific?.immunosuppressant || '正常'}`}
- 气管插管：${update.tags.intubation.status === 'extubated' ? '已拔除' : update.tags.intubation.status === 'new' ? '新置入' : '在位'} (${update.tags.intubation.detail})
- 引流管：${update.tags.drainage.status === 'extubated' ? '已拔除' : update.tags.drainage.status === 'new' ? '新置入' : '在位'} (${update.tags.drainage.detail})
- 尿管：${update.tags.urinaryCatheter.status === 'extubated' ? '已拔除' : update.tags.urinaryCatheter.status === 'new' ? '新置入' : '在位'} (${update.tags.urinaryCatheter.detail})
- 饮食：${update.tags.diet}
- 活动：${update.tags.activity}
- 睡眠：${update.tags.sleep}
- 目前主要问题：${update.tags.mainProblem || '无明显问题'}
- 需求物资：${update.needs.join(', ')}`
  });

  const response = await model;
  return response.text || "生成报告失败，请稍后重试。";
}

// --- Components ---

const Button = ({ 
  children, 
  className, 
  variant = 'primary', 
  isLoading, 
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost', isLoading?: boolean }) => {
  const variants = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
    secondary: 'bg-slate-800 text-white hover:bg-slate-900 shadow-sm',
    outline: 'border border-slate-200 text-slate-700 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100'
  };

  return (
    <button 
      className={cn(
        'px-4 py-2 rounded-xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        className
      )}
      disabled={isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
};

const Card = ({ children, className, onClick }: { children: React.ReactNode, className?: string, onClick?: () => void }) => (
  <div 
    onClick={onClick}
    className={cn('bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden', className, onClick && 'cursor-pointer active:scale-[0.98] transition-transform')}
  >
    {children}
  </div>
);

const Badge = ({ children, variant = 'neutral' }: { children: React.ReactNode, variant?: 'success' | 'warning' | 'error' | 'neutral' }) => {
  const variants = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    warning: 'bg-amber-50 text-amber-700 border-amber-100',
    error: 'bg-rose-50 text-rose-700 border-rose-100',
    neutral: 'bg-slate-50 text-slate-700 border-slate-100'
  };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium border', variants[variant])}>
      {children}
    </span>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [role, setRole] = useState<'nurse' | 'family' | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'list' | 'update' | 'report'>('list');

  // Mock authentication for testing phase
  const handleTestLogin = (selectedRole: 'nurse' | 'family') => {
    setUser({
      uid: 'test-user-id',
      phoneNumber: '测试账号',
      displayName: '测试用户'
    });
    setRole(selectedRole);
  };

  useEffect(() => {
    // In test mode, we still try to fetch patients
    // Note: Firestore rules might need to be relaxed or we use a mock patient list if rules block
    const q = query(collection(db, 'patients'), orderBy('bedNumber', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const pData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Patient));
      setPatients(pData);
    }, (error) => {
      console.warn("Firestore access error (likely auth related):", error);
      // Fallback for testing if database is empty or blocked
      if (patients.length === 0) {
        setPatients([
          { id: '1', name: '张三', bedNumber: '01', type: 'transplant', status: 'green' },
          { id: '2', name: '李四', bedNumber: '05', type: 'lvad', status: 'yellow' }
        ]);
      }
    });
    return unsubscribe;
  }, [user]);

  const handleLogout = () => {
    setUser(null);
    setRole(null);
    setView('list');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!role) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full"
        >
          <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner">
            <Heart className="w-10 h-10 text-emerald-600 fill-emerald-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">心外ICU家属桥</h1>
          <Badge variant="warning">测试阶段 · 免登录</Badge>
          <p className="text-slate-600 mt-6 mb-10 leading-relaxed">
            点击下方按钮直接进入对应角色界面进行功能测试。
          </p>
          
          <div className="grid grid-cols-1 gap-4">
            <button 
              onClick={() => handleTestLogin('nurse')}
              className="p-6 bg-white rounded-3xl border-2 border-transparent hover:border-emerald-500 transition-all shadow-sm flex items-center gap-4 group text-left"
            >
              <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                <Stethoscope className="w-7 h-7 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">进入护士站 (测试)</h3>
                <p className="text-xs text-slate-500">模拟护士录入与AI报告生成</p>
              </div>
            </button>

            <button 
              onClick={() => handleTestLogin('family')}
              className="p-6 bg-white rounded-3xl border-2 border-transparent hover:border-blue-500 transition-all shadow-sm flex items-center gap-4 group text-left"
            >
              <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                <Heart className="w-7 h-7 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">进入家属端 (测试)</h3>
                <p className="text-xs text-slate-500">模拟家属接收与查看日报</p>
              </div>
            </button>
          </div>
          
          <p className="mt-10 text-[10px] text-slate-400 uppercase tracking-widest">
            Heart ICU Bridge · Alpha Test
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <header className="bg-white border-bottom border-slate-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart className="w-6 h-6 text-emerald-600 fill-emerald-600" />
            <span className="font-bold text-slate-900">ICU家属桥</span>
            <Badge variant="neutral">测试模式</Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right mr-2">
              <p className="text-xs font-bold text-slate-900">{role === 'nurse' ? '护士站' : '家属端'}</p>
              <p className="text-[10px] text-slate-400">模拟环境</p>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-600"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        {role === 'nurse' ? (
          <NurseView 
            patients={patients} 
            selectedPatient={selectedPatient}
            setSelectedPatient={setSelectedPatient}
            view={view}
            setView={setView}
          />
        ) : (
          <FamilyView 
            patients={patients}
            selectedPatient={selectedPatient}
            setSelectedPatient={setSelectedPatient}
            view={view}
            setView={setView}
          />
        )}
      </main>
    </div>
  );
}

// --- Nurse View ---

function NurseView({ patients, selectedPatient, setSelectedPatient, view, setView }: any) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeNurseTab, setActiveNurseTab] = useState<'update' | 'chat'>('update');
  const [newMessage, setNewMessage] = useState('');
  const [formData, setFormData] = useState<any>({
    vitalSigns: 'stable',
    temperature: 'normal',
    bloodPressure: 'normal',
    heartRate: 'normal',
    oxygen: 'normal',
    lvadStatus: 'normal',
    intubation: { status: 'normal', detail: '' },
    drainage: { status: 'normal', detail: '' },
    urinaryCatheter: { status: 'normal', detail: '' },
    diet: 'npo',
    activity: 'bed',
    sleep: 'good',
    mainProblem: '',
    transplantSpecific: {
      rejectionSigns: 'none',
      immunosuppressant: 'target'
    },
    lvadSpecific: {
      pumpSpeed: '',
      pumpFlow: '',
      pumpPower: '',
      drivelineSite: ''
    },
    needs: []
  });

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newPatient, setNewPatient] = useState({ name: '', bedNumber: '', type: 'transplant' as 'transplant' | 'lvad' });

  const handleAddPatient = async () => {
    if (newPatient.name && newPatient.bedNumber) {
      setIsSubmitting(true);
      try {
        await addDoc(collection(db, 'patients'), {
          name: newPatient.name,
          bedNumber: newPatient.bedNumber,
          type: newPatient.type,
          status: 'green',
          lastUpdate: serverTimestamp()
        });
        setIsAddModalOpen(false);
        setNewPatient({ name: '', bedNumber: '', type: 'transplant' });
      } catch (error) {
        console.error(error);
        alert("添加失败");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleSubmitUpdate = async () => {
    if (!selectedPatient) return;
    setIsSubmitting(true);
    try {
      // 1. Save Update
      const updateRef = await addDoc(collection(db, 'patients', selectedPatient.id, 'updates'), {
        tags: formData,
        timestamp: serverTimestamp(),
        needs: formData.needs
      });

      // 2. Generate AI Report
      const reportContent = await generateReport({ tags: formData, needs: formData.needs } as any, selectedPatient);

      // 3. Save Report
      await addDoc(collection(db, 'patients', selectedPatient.id, 'reports'), {
        content: reportContent,
        timestamp: serverTimestamp(),
        status: selectedPatient.status
      });

      // 4. Update Patient Status
      await updateDoc(doc(db, 'patients', selectedPatient.id), {
        lastUpdate: serverTimestamp()
      });

      setView('list');
      alert("更新成功，日报已发送给家属。");
    } catch (error) {
      console.error(error);
      alert("提交失败，请重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!selectedPatient) return;
    const messagesQ = query(
      collection(db, 'patients', selectedPatient.id, 'messages'),
      orderBy('timestamp', 'asc')
    );
    const unsubscribe = onSnapshot(messagesQ, (snapshot) => {
      const mData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(mData);
    });
    return unsubscribe;
  }, [selectedPatient]);

  const handleSendMessage = async () => {
    if (!selectedPatient || !newMessage.trim()) return;
    try {
      await addDoc(collection(db, 'patients', selectedPatient.id, 'messages'), {
        senderId: 'nurse-user',
        senderRole: 'nurse',
        type: 'text',
        content: newMessage,
        timestamp: serverTimestamp()
      });
      setNewMessage('');
    } catch (error) {
      console.error(error);
    }
  };

  if (view === 'update' && selectedPatient) {
    return (
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => setView('list')} className="p-2 hover:bg-slate-100 rounded-full">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-bold">{selectedPatient.bedNumber}床 {selectedPatient.name}</h2>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button 
              onClick={() => setActiveNurseTab('update')}
              className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", activeNurseTab === 'update' ? "bg-white shadow-sm text-emerald-600" : "text-slate-500")}
            >
              状态更新
            </button>
            <button 
              onClick={() => setActiveNurseTab('chat')}
              className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", activeNurseTab === 'chat' ? "bg-white shadow-sm text-blue-600" : "text-slate-500")}
            >
              家属留言 {messages.filter(m => m.senderRole === 'family').length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-rose-500 text-white text-[10px] rounded-full">!</span>}
            </button>
          </div>
        </div>

        {activeNurseTab === 'update' ? (
          <div className="space-y-6">
          <Card className="p-6">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-600" /> 基础生命体征
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">总体状态</label>
                <div className="flex gap-2">
                  {['stable', 'monitoring', 'critical'].map(s => (
                    <button
                      key={s}
                      onClick={() => setFormData({ ...formData, vitalSigns: s })}
                      className={cn(
                        "flex-1 py-2 rounded-full border text-sm transition-all",
                        formData.vitalSigns === s ? "bg-emerald-100 border-emerald-500 text-emerald-700" : "bg-white border-slate-200 text-slate-600"
                      )}
                    >
                      {s === 'stable' ? '平稳' : s === 'monitoring' ? '观察' : '波动'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">体温状态</label>
                <div className="flex gap-2">
                  {[
                    { id: 'low', label: '低体温' },
                    { id: 'normal', label: '正常' },
                    { id: 'fever_low', label: '低烧' },
                    { id: 'fever_high', label: '高烧' }
                  ].map(s => (
                    <button
                      key={s.id}
                      onClick={() => setFormData({ ...formData, temperature: s.id })}
                      className={cn(
                        "flex-1 py-2 rounded-full border text-xs transition-all",
                        formData.temperature === s.id ? "bg-orange-100 border-orange-500 text-orange-700" : "bg-white border-slate-200 text-slate-600"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">氧合状态</label>
                <div className="flex gap-2">
                  {['normal', 'low'].map(s => (
                    <button
                      key={s}
                      onClick={() => setFormData({ ...formData, oxygen: s })}
                      className={cn(
                        "flex-1 py-2 rounded-full border text-sm transition-all",
                        formData.oxygen === s ? "bg-blue-100 border-blue-500 text-blue-700" : "bg-white border-slate-200 text-slate-600"
                      )}
                    >
                      {s === 'normal' ? '正常' : '偏低'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">血压状态</label>
                <div className="flex gap-2">
                  {['normal', 'low', 'high'].map(s => (
                    <button
                      key={s}
                      onClick={() => setFormData({ ...formData, bloodPressure: s })}
                      className={cn(
                        "flex-1 py-2 rounded-full border text-sm transition-all",
                        formData.bloodPressure === s ? "bg-rose-100 border-rose-500 text-rose-700" : "bg-white border-slate-200 text-slate-600"
                      )}
                    >
                      {s === 'normal' ? '正常' : s === 'low' ? '偏低' : '偏高'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">心率状态</label>
                <div className="flex gap-2">
                  {['normal', 'slow', 'fast'].map(s => (
                    <button
                      key={s}
                      onClick={() => setFormData({ ...formData, heartRate: s })}
                      className={cn(
                        "flex-1 py-2 rounded-full border text-sm transition-all",
                        formData.heartRate === s ? "bg-amber-100 border-amber-500 text-amber-700" : "bg-white border-slate-200 text-slate-600"
                      )}
                    >
                      {s === 'normal' ? '正常' : s === 'slow' ? '偏慢' : '偏快'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-600" /> 设备与管路
            </h3>
            <div className="space-y-6">
              <div className="space-y-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">气管插管状态</label>
                  <div className="flex gap-2">
                    {['normal', 'extubated', 'new'].map(s => (
                      <button
                        key={s}
                        onClick={() => setFormData({ ...formData, intubation: { ...formData.intubation, status: s } })}
                        className={cn(
                          "flex-1 py-2 rounded-full border text-xs transition-all",
                          formData.intubation.status === s ? "bg-emerald-100 border-emerald-500 text-emerald-700" : "bg-white border-slate-200 text-slate-600"
                        )}
                      >
                        {s === 'normal' ? '在位' : s === 'extubated' ? '已拔除' : '新置入'}
                      </button>
                    ))}
                  </div>
                  <input 
                    type="text" 
                    placeholder="备注 (如: 呼吸机参数正常)" 
                    value={formData.intubation.detail}
                    onChange={(e) => setFormData({ ...formData, intubation: { ...formData.intubation, detail: e.target.value } })}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-full focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">引流管状态</label>
                  <div className="flex gap-2">
                    {['normal', 'extubated', 'new'].map(s => (
                      <button
                        key={s}
                        onClick={() => setFormData({ ...formData, drainage: { ...formData.drainage, status: s } })}
                        className={cn(
                          "flex-1 py-2 rounded-full border text-xs transition-all",
                          formData.drainage.status === s ? "bg-emerald-100 border-emerald-500 text-emerald-700" : "bg-white border-slate-200 text-slate-600"
                        )}
                      >
                        {s === 'normal' ? '在位' : s === 'extubated' ? '已拔除' : '新置入'}
                      </button>
                    ))}
                  </div>
                  <input 
                    type="text" 
                    placeholder="备注 (如: 通畅, 50ml)" 
                    value={formData.drainage.detail}
                    onChange={(e) => setFormData({ ...formData, drainage: { ...formData.drainage, detail: e.target.value } })}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-full focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">尿管状态</label>
                  <div className="flex gap-2">
                    {['normal', 'extubated', 'new'].map(s => (
                      <button
                        key={s}
                        onClick={() => setFormData({ ...formData, urinaryCatheter: { ...formData.urinaryCatheter, status: s } })}
                        className={cn(
                          "flex-1 py-2 rounded-full border text-xs transition-all",
                          formData.urinaryCatheter.status === s ? "bg-emerald-100 border-emerald-500 text-emerald-700" : "bg-white border-slate-200 text-slate-600"
                        )}
                      >
                        {s === 'normal' ? '在位' : s === 'extubated' ? '已拔除' : '新置入'}
                      </button>
                    ))}
                  </div>
                  <input 
                    type="text" 
                    placeholder="备注 (如: 正常, 100ml)" 
                    value={formData.urinaryCatheter.detail}
                    onChange={(e) => setFormData({ ...formData, urinaryCatheter: { ...formData.urinaryCatheter, detail: e.target.value } })}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-full focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                  />
                </div>
              </div>

              {selectedPatient.type === 'lvad' ? (
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <h4 className="text-sm font-bold text-blue-600">LVAD 专项参数</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {['normal', 'alarm', 'off'].map(s => (
                      <button
                        key={s}
                        onClick={() => setFormData({ ...formData, lvadStatus: s })}
                        className={cn(
                          "py-2 rounded-lg border transition-all text-sm",
                          formData.lvadStatus === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200"
                        )}
                      >
                        {s === 'normal' ? '良好' : s === 'alarm' ? '警报' : '未开启'}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">泵速</label>
                      <input 
                        type="text" 
                        value={formData.lvadSpecific.pumpSpeed}
                        onChange={(e) => setFormData({ ...formData, lvadSpecific: { ...formData.lvadSpecific, pumpSpeed: e.target.value } })}
                        className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">流量</label>
                      <input 
                        type="text" 
                        value={formData.lvadSpecific.pumpFlow}
                        onChange={(e) => setFormData({ ...formData, lvadSpecific: { ...formData.lvadSpecific, pumpFlow: e.target.value } })}
                        className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">功率</label>
                      <input 
                        type="text" 
                        value={formData.lvadSpecific.pumpPower}
                        onChange={(e) => setFormData({ ...formData, lvadSpecific: { ...formData.lvadSpecific, pumpPower: e.target.value } })}
                        className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">泵缆出口处情况</label>
                    <input 
                      type="text" 
                      placeholder="如: 干燥, 无渗出"
                      value={formData.lvadSpecific.drivelineSite}
                      onChange={(e) => setFormData({ ...formData, lvadSpecific: { ...formData.lvadSpecific, drivelineSite: e.target.value } })}
                      className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <h4 className="text-sm font-bold text-emerald-600">移植专项观察</h4>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">排异迹象</label>
                    <div className="flex gap-2 mt-1">
                      {['none', 'mild', 'moderate', 'severe'].map(s => (
                        <button
                          key={s}
                          onClick={() => setFormData({ ...formData, transplantSpecific: { ...formData.transplantSpecific, rejectionSigns: s } })}
                          className={cn(
                            "flex-1 py-2 rounded-lg border text-[10px] transition-all",
                            formData.transplantSpecific.rejectionSigns === s ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200"
                          )}
                        >
                          {s === 'none' ? '无' : s === 'mild' ? '轻度' : s === 'moderate' ? '中度' : '严重'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">免疫抑制剂浓度</label>
                    <div className="flex gap-2 mt-1">
                      {['target', 'low', 'high'].map(s => (
                        <button
                          key={s}
                          onClick={() => setFormData({ ...formData, transplantSpecific: { ...formData.transplantSpecific, immunosuppressant: s } })}
                          className={cn(
                            "flex-1 py-2 rounded-lg border text-[10px] transition-all",
                            formData.transplantSpecific.immunosuppressant === s ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200"
                          )}
                        >
                          {s === 'target' ? '达标' : s === 'low' ? '偏低' : '偏高'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-amber-600" /> 日常与康复
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-500 mb-2 block">饮食状态</label>
                <div className="flex flex-wrap gap-2">
                  {['npo', 'liquid', 'soft', 'normal'].map(s => (
                    <button
                      key={s}
                      onClick={() => setFormData({ ...formData, diet: s })}
                      className={cn(
                        "px-4 py-2 rounded-full border text-sm transition-all",
                        formData.diet === s ? "bg-amber-100 border-amber-500 text-amber-700" : "bg-white border-slate-200 text-slate-600"
                      )}
                    >
                      {s === 'npo' ? '禁食' : s === 'liquid' ? '流食' : s === 'soft' ? '半流食' : '普食'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm text-slate-500 mb-2 block">活动量</label>
                <div className="flex flex-wrap gap-2">
                  {['bed', 'sit', 'stand', 'walk'].map(s => (
                    <button
                      key={s}
                      onClick={() => setFormData({ ...formData, activity: s })}
                      className={cn(
                        "px-4 py-2 rounded-full border text-sm transition-all",
                        formData.activity === s ? "bg-indigo-100 border-indigo-500 text-indigo-700" : "bg-white border-slate-200 text-slate-600"
                      )}
                    >
                      {s === 'bed' ? '卧床' : s === 'sit' ? '床边坐' : s === 'stand' ? '站立' : '行走'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm text-slate-500 mb-2 block">睡眠情况</label>
                <div className="flex flex-wrap gap-2">
                  {['good', 'fair', 'poor'].map(s => (
                    <button
                      key={s}
                      onClick={() => setFormData({ ...formData, sleep: s })}
                      className={cn(
                        "px-4 py-2 rounded-full border text-sm transition-all",
                        formData.sleep === s ? "bg-purple-100 border-purple-500 text-purple-700" : "bg-white border-slate-200 text-slate-600"
                      )}
                    >
                      {s === 'good' ? '良好' : s === 'fair' ? '一般' : '较差'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-rose-600" /> 目前主要问题
            </h3>
            <textarea 
              placeholder="请输入患者目前面临的主要医疗或心理问题..." 
              value={formData.mainProblem}
              onChange={(e) => setFormData({ ...formData, mainProblem: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none min-h-[100px]"
            />
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Droplets className="w-5 h-5 text-blue-500" /> 生活物资需求
            </h3>
            <div className="flex flex-wrap gap-2 mb-4">
              {['纸巾', '洗漱用品', '换洗衣物', '水果', '营养品', '充电器'].map(item => (
                <button
                  key={item}
                  onClick={() => {
                    const newNeeds = formData.needs.includes(item) 
                      ? formData.needs.filter((i: string) => i !== item)
                      : [...formData.needs, item];
                    setFormData({ ...formData, needs: newNeeds });
                  }}
                  className={cn(
                    "px-4 py-2 rounded-full border text-sm transition-all",
                    formData.needs.includes(item) ? "bg-blue-100 border-blue-500 text-blue-700" : "bg-white border-slate-200 text-slate-600"
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
            <input 
              type="text" 
              placeholder="添加其他物资..." 
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value;
                  if (val && !formData.needs.includes(val)) {
                    setFormData({ ...formData, needs: [...formData.needs, val] });
                    (e.target as HTMLInputElement).value = '';
                  }
                }
              }}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </Card>

          <Button 
            onClick={handleSubmitUpdate} 
            className="w-full py-4 text-lg"
            isLoading={isSubmitting}
          >
            生成并发送日报
          </Button>
        </div>
        ) : (
          <div className="flex flex-col h-[600px] bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <span className="text-sm font-medium text-slate-600">家属留言板</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className={cn("flex flex-col", msg.senderRole === 'nurse' ? "items-end" : "items-start")}>
                  <div className={cn(
                    "max-w-[80%] p-3 rounded-2xl text-sm shadow-sm",
                    msg.senderRole === 'nurse' ? "bg-emerald-600 text-white rounded-tr-none" : "bg-slate-100 text-slate-800 rounded-tl-none"
                  )}>
                    {msg.type === 'text' ? (
                      <p>{msg.content}</p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Mic className="w-4 h-4" />
                        <span>语音留言</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1">
                    {msg.timestamp ? new Date(msg.timestamp.seconds * 1000).toLocaleTimeString() : ''}
                  </span>
                </div>
              ))}
              {messages.length === 0 && (
                <div className="text-center py-20 opacity-30">
                  <MessageSquare className="w-12 h-12 mx-auto mb-2" />
                  <p className="text-sm">暂无家属留言</p>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2">
                <input 
                  type="text" 
                  placeholder="回复家属..." 
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <button 
                  onClick={handleSendMessage}
                  className="p-3 bg-emerald-600 text-white rounded-full hover:bg-emerald-700 transition-all"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900">患者列表</h2>
        <Button variant="outline" onClick={() => setIsAddModalOpen(true)} className="rounded-full">
          <Plus className="w-5 h-5" /> 添加患者
        </Button>
      </div>

      {/* Add Patient Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-xl p-8"
            >
              <h3 className="text-xl font-bold mb-6">添加新患者</h3>
              <div className="space-y-4 mb-8">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">患者姓名</label>
                  <input 
                    type="text" 
                    placeholder="请输入姓名" 
                    value={newPatient.name}
                    onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
                    className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">床号</label>
                  <input 
                    type="text" 
                    placeholder="例如: 01" 
                    value={newPatient.bedNumber}
                    onChange={(e) => setNewPatient({ ...newPatient, bedNumber: e.target.value })}
                    className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">患者类型</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button 
                      onClick={() => setNewPatient({ ...newPatient, type: 'transplant' })}
                      className={cn("py-2 rounded-lg border text-sm", newPatient.type === 'transplant' ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200")}
                    >
                      心脏移植
                    </button>
                    <button 
                      onClick={() => setNewPatient({ ...newPatient, type: 'lvad' })}
                      className={cn("py-2 rounded-lg border text-sm", newPatient.type === 'lvad' ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200")}
                    >
                      左心室辅助
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setIsAddModalOpen(false)} className="flex-1">取消</Button>
                <Button onClick={handleAddPatient} isLoading={isSubmitting} className="flex-1">确认添加</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="space-y-8">
        {['transplant', 'lvad'].map(type => {
          const filteredPatients = patients.filter((p: Patient) => p.type === type);
          if (filteredPatients.length === 0) return null;

          return (
            <div key={type}>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full", type === 'transplant' ? "bg-emerald-500" : "bg-blue-500")} />
                {type === 'transplant' ? '心脏移植患者' : '左心室辅助 (LVAD) 患者'}
              </h3>
              <div className="grid grid-cols-1 gap-4">
                {filteredPatients.map((p: Patient) => (
                  <Card key={p.id} className="p-4 hover:border-emerald-200 transition-colors cursor-pointer" onClick={() => {
                    setSelectedPatient(p);
                    setView('update');
                  }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg",
                          p.status === 'green' ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                        )}>
                          {p.bedNumber}
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900">{p.name}</h3>
                          <p className="text-xs text-slate-400">
                            最后更新: {p.lastUpdate ? new Date(p.lastUpdate.seconds * 1000).toLocaleTimeString() : '暂无'}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300" />
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Family View ---

function FamilyView({ patients, selectedPatient, setSelectedPatient, view, setView }: any) {
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'report' | 'chat'>('report');
  const [newMessage, setNewMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  
  // Family Login State
  const [loginData, setLoginData] = useState({ bedNumber: '', name: '' });
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const handleLogin = () => {
    const patient = patients.find((p: Patient) => 
      p.bedNumber === loginData.bedNumber && 
      p.name === loginData.name
    );
    if (patient) {
      setSelectedPatient(patient);
      setIsLoggedIn(true);
      setView('report');
    } else {
      alert("未找到对应患者，请检查床号和姓名是否正确。");
    }
  };

  useEffect(() => {
    if (!selectedPatient || !isLoggedIn) return;
    setLoading(true);
    
    // Reports listener
    const reportsQ = query(
      collection(db, 'patients', selectedPatient.id, 'reports'), 
      orderBy('timestamp', 'desc'),
      limit(5)
    );
    const unsubscribeReports = onSnapshot(reportsQ, (snapshot) => {
      const rData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DailyReport));
      setReports(rData);
      setLoading(false);
    });

    // Messages listener
    const messagesQ = query(
      collection(db, 'patients', selectedPatient.id, 'messages'),
      orderBy('timestamp', 'asc')
    );
    const unsubscribeMessages = onSnapshot(messagesQ, (snapshot) => {
      const mData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(mData);
    });

    return () => {
      unsubscribeReports();
      unsubscribeMessages();
    };
  }, [selectedPatient]);

  const handleSendMessage = async (type: 'text' | 'voice', content?: string) => {
    if (!selectedPatient) return;
    if (type === 'text' && !newMessage.trim()) return;

    try {
      await addDoc(collection(db, 'patients', selectedPatient.id, 'messages'), {
        senderId: 'family-user', // In real app, use user.uid
        senderRole: 'family',
        type,
        content: type === 'text' ? newMessage : content,
        timestamp: serverTimestamp()
      });
      setNewMessage('');
    } catch (error) {
      console.error(error);
    }
  };

  const handleRequestCall = async () => {
    if (!selectedPatient) return;
    alert("视频通话请求已发送给护士站，请耐心等待。");
    await handleSendMessage('text', "🔔 发起了视频通话请求");
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 border border-slate-100"
        >
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <User className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-2">家属验证</h2>
          <p className="text-slate-500 text-center text-sm mb-8">请输入患者信息以进入系统</p>
          
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">床号</label>
              <input 
                type="text" 
                placeholder="例如: 01" 
                value={loginData.bedNumber}
                onChange={(e) => setLoginData({ ...loginData, bedNumber: e.target.value })}
                className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">患者姓名</label>
              <input 
                type="text" 
                placeholder="请输入患者姓名" 
                value={loginData.name}
                onChange={(e) => setLoginData({ ...loginData, name: e.target.value })}
                className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
            <Button onClick={handleLogin} className="w-full py-4 text-lg bg-blue-600 hover:bg-blue-700 mt-4">
              验证并进入
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (selectedPatient && view === 'report') {
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => {
              setIsLoggedIn(false);
              setSelectedPatient(null);
            }} className="p-2 hover:bg-slate-100 rounded-full">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-bold">{selectedPatient.name}</h2>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button 
              onClick={() => setActiveTab('report')}
              className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", activeTab === 'report' ? "bg-white shadow-sm text-emerald-600" : "text-slate-500")}
            >
              康复日报
            </button>
            <button 
              onClick={() => setActiveTab('chat')}
              className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", activeTab === 'chat' ? "bg-white shadow-sm text-blue-600" : "text-slate-500")}
            >
              留言互动
            </button>
          </div>
        </div>

        {activeTab === 'report' ? (
          loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            </div>
          ) : reports.length > 0 ? (
            <div className="space-y-6">
              {reports.map((report, idx) => (
                <Card key={report.id} className={cn("p-6", idx === 0 ? "border-emerald-200 ring-4 ring-emerald-50" : "opacity-70")}>
                  <div className="flex items-center justify-between mb-4">
                    <Badge variant={report.status === 'green' ? 'success' : 'warning'}>
                      {idx === 0 ? '今日日报' : '历史记录'}
                    </Badge>
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {report.timestamp ? new Date(report.timestamp.seconds * 1000).toLocaleString() : ''}
                    </span>
                  </div>
                  <div className="prose prose-slate max-w-none">
                    <ReactMarkdown>{report.content}</ReactMarkdown>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-200">
              <FileText className="w-12 h-12 text-slate-200 mx-auto mb-4" />
              <p className="text-slate-500">暂无日报，护士正在努力录入中...</p>
            </div>
          )
        ) : (
          <div className="flex flex-col h-[600px] bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-sm font-medium text-slate-600">在线留言中心</span>
              </div>
              <Button variant="outline" onClick={handleRequestCall} className="text-xs py-1.5 h-auto">
                <Video className="w-3.5 h-3.5 mr-1" /> 请求视频通话
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className={cn("flex flex-col", msg.senderRole === 'family' ? "items-end" : "items-start")}>
                  <div className={cn(
                    "max-w-[80%] p-3 rounded-2xl text-sm shadow-sm",
                    msg.senderRole === 'family' ? "bg-blue-600 text-white rounded-tr-none" : "bg-slate-100 text-slate-800 rounded-tl-none"
                  )}>
                    {msg.type === 'text' ? (
                      <p>{msg.content}</p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Mic className="w-4 h-4" />
                        <span>语音留言 (点击播放)</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1">
                    {msg.timestamp ? new Date(msg.timestamp.seconds * 1000).toLocaleTimeString() : ''}
                  </span>
                </div>
              ))}
              {messages.length === 0 && (
                <div className="text-center py-20 opacity-30">
                  <Send className="w-12 h-12 mx-auto mb-2" />
                  <p className="text-sm">发送第一条留言给护士吧</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2">
                <button 
                  onMouseDown={() => setIsRecording(true)}
                  onMouseUp={() => {
                    setIsRecording(false);
                    handleSendMessage('voice', '语音消息已发送');
                  }}
                  className={cn(
                    "p-3 rounded-full transition-all",
                    isRecording ? "bg-rose-100 text-rose-600 scale-125" : "bg-white text-slate-400 hover:text-blue-600"
                  )}
                >
                  <Mic className="w-6 h-6" />
                </button>
                <input 
                  type="text" 
                  placeholder="输入留言..." 
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage('text')}
                  className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button 
                  onClick={() => handleSendMessage('text')}
                  className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-all"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
              {isRecording && <p className="text-center text-[10px] text-rose-500 mt-2 animate-pulse">松开结束录音并发送</p>}
            </div>
          </div>
        )}
      </motion.div>
    );
  }

  return null;
}
