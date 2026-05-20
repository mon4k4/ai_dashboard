import { useState } from 'react';
import { X, Trash2, Save, Calendar, Clock } from 'lucide-react';
import { useAppContext } from '../store/AppContext';
import type { ProjectMeeting } from '../services/llmService';

interface MeetingEditModalProps {
  projectId: string;
  meetingId: string;
  occurrenceDate: string;
  onClose: () => void;
}

export default function MeetingEditModal({ projectId, meetingId, occurrenceDate, onClose }: MeetingEditModalProps) {
  const { projects, updateProject } = useAppContext();

  const project = projects.find(p => p.id === projectId);
  if (!project || !project.meetings) return null;

  const meeting = project.meetings.find(m => m.id === meetingId);
  if (!meeting) return null;

  // 定例会議の場合は、初期で「この回のみ変更 (occurrence)」を選択させておく
  const [editMode, setEditMode] = useState<'occurrence' | 'series'>(
    meeting.isRecurring ? 'occurrence' : 'occurrence'
  );

  const [title, setTitle] = useState(meeting.title);
  // 開始・終了時刻
  const [startTime, setStartTime] = useState(meeting.startTime || meeting.time || '');
  const [endTime, setEndTime] = useState(meeting.endTime || '');

  // 日程設定
  const [singleDate, setSingleDate] = useState(occurrenceDate); // 単発または「この回のみ」の場合
  const [startDate, setStartDate] = useState(meeting.startDate || ''); // シリーズ全体
  const [endDate, setEndDate] = useState(meeting.endDate || ''); // シリーズ全体
  const [dayOfWeek, setDayOfWeek] = useState<number>(meeting.dayOfWeek ?? 1); // シリーズ全体

  const daysStr = ['日', '月', '火', '水', '木', '金', '土'];

  const addOneHour = (timeStr: string) => {
    if (!timeStr) return '';
    const [hourStr, minStr] = timeStr.split(':');
    let hour = parseInt(hourStr, 10);
    let min = parseInt(minStr, 10);
    hour = (hour + 1) % 24;
    const newHourStr = String(hour).padStart(2, '0');
    const newMinStr = String(min).padStart(2, '0');
    return `${newHourStr}:${newMinStr}`;
  };

  const handleStartTimeChange = (val: string) => {
    setStartTime(val);
    if (val) {
      setEndTime(addOneHour(val));
    }
  };

  const handleSave = () => {
    if (!title.trim()) return;

    let updatedMeetings = [...(project.meetings || [])];

    if (!meeting.isRecurring) {
      // 1. 単発会議の更新
      updatedMeetings = updatedMeetings.map(m =>
        m.id === meetingId
          ? {
              ...m,
              title: title.trim(),
              date: singleDate,
              startTime,
              endTime,
              time: startTime
            }
          : m
      );
    } else {
      if (editMode === 'occurrence') {
        // 2. 定例会議の「この回のみ」更新
        // 元の定例会議に除外日（例外）を追加
        const exceptions = meeting.exceptions ? [...meeting.exceptions] : [];
        if (!exceptions.includes(occurrenceDate)) {
          exceptions.push(occurrenceDate);
        }

        updatedMeetings = updatedMeetings.map(m =>
          m.id === meetingId ? { ...m, exceptions } : m
        );

        // 新しい単発会議として保存
        const newSingleMeet: ProjectMeeting = {
          id: `meet-split-${Date.now()}`,
          title: title.trim(),
          isRecurring: false,
          date: singleDate,
          startTime,
          endTime,
          time: startTime
        };
        updatedMeetings.push(newSingleMeet);
      } else {
        // 3. 定例会議の「シリーズ全体」更新
        updatedMeetings = updatedMeetings.map(m =>
          m.id === meetingId
            ? {
                ...m,
                title: title.trim(),
                startDate,
                endDate,
                dayOfWeek,
                startTime,
                endTime,
                time: startTime
              }
            : m
        );
      }
    }

    updateProject(projectId, { meetings: updatedMeetings });
    onClose();
  };

  const handleDelete = () => {
    let updatedMeetings = [...(project.meetings || [])];

    if (!meeting.isRecurring) {
      // 1. 単発会議の削除
      updatedMeetings = updatedMeetings.filter(m => m.id !== meetingId);
    } else {
      if (editMode === 'occurrence') {
        // 2. 定例会議の「この回のみ」削除 (例外日に追加)
        const exceptions = meeting.exceptions ? [...meeting.exceptions] : [];
        if (!exceptions.includes(occurrenceDate)) {
          exceptions.push(occurrenceDate);
        }
        updatedMeetings = updatedMeetings.map(m =>
          m.id === meetingId ? { ...m, exceptions } : m
        );
      } else {
        // 3. 定例会議の「シリーズ全体」削除
        updatedMeetings = updatedMeetings.filter(m => m.id !== meetingId);
      }
    }

    updateProject(projectId, { meetings: updatedMeetings });
    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>打ち合わせ詳細編集</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>プロジェクト: {project.name}</span>
          </div>
          <button style={styles.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        <div style={styles.body}>
          {meeting.isRecurring && (
            <div style={styles.modeSelector}>
              <label style={{ ...styles.radioLabel, borderRight: '1px solid var(--border-color)' }}>
                <input
                  type="radio"
                  name="editMode"
                  checked={editMode === 'occurrence'}
                  onChange={() => setEditMode('occurrence')}
                  style={{ marginRight: '0.5rem' }}
                />
                この回のみ変更/削除
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="editMode"
                  checked={editMode === 'series'}
                  onChange={() => setEditMode('series')}
                  style={{ marginRight: '0.5rem' }}
                />
                シリーズ全体を変更/削除
              </label>
            </div>
          )}

          <div style={styles.fieldGroup}>
            <label style={styles.label}>タイトル *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={styles.input}
              placeholder="会議のタイトル"
            />
          </div>

          {/* 日程設定エリア */}
          {(!meeting.isRecurring || editMode === 'occurrence') ? (
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                <Calendar size={14} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                日付
              </label>
              <input
                type="date"
                value={singleDate}
                onChange={e => setSingleDate(e.target.value)}
                style={styles.input}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '100px' }}>
                <label style={styles.label}>曜日</label>
                <select
                  value={dayOfWeek}
                  onChange={e => setDayOfWeek(Number(e.target.value))}
                  style={styles.input}
                >
                  {daysStr.map((d, i) => <option key={i} value={i}>{d}曜日</option>)}
                </select>
              </div>
              <div style={{ flex: 1.2, minWidth: '130px' }}>
                <label style={styles.label}>開始日</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  style={styles.input}
                />
              </div>
              <div style={{ flex: 1.2, minWidth: '130px' }}>
                <label style={styles.label}>終了日</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  style={styles.input}
                />
              </div>
            </div>
          )}

          {/* 時間設定エリア */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>
                <Clock size={14} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                開始時間
              </label>
              <input
                type="time"
                value={startTime}
                onChange={e => handleStartTimeChange(e.target.value)}
                style={styles.input}
              />
            </div>
            <span style={{ marginTop: '1.2rem', color: 'var(--text-muted)' }}>〜</span>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>
                <Clock size={14} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                終了時間
              </label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                style={styles.input}
              />
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          <button style={styles.deleteBtn} onClick={handleDelete}>
            <Trash2 size={16} style={{ marginRight: '0.25rem' }} />
            削除
          </button>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button style={styles.cancelBtn} onClick={onClose}>キャンセル</button>
            <button style={styles.saveBtn} onClick={handleSave} disabled={!title.trim()}>
              <Save size={16} style={{ marginRight: '0.25rem' }} />
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: 'var(--bg-main)',
    width: '90%',
    maxWidth: '480px',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg)',
    display: 'flex',
    flexDirection: 'column' as const,
    maxHeight: '90vh',
    border: '1px solid var(--border-color)',
  },
  header: {
    padding: '1.25rem 1.5rem',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '0.2rem',
  },
  body: {
    padding: '1.5rem',
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1.25rem',
  },
  modeSelector: {
    display: 'flex',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
  },
  radioLabel: {
    flex: 1,
    padding: '0.75rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    userSelect: 'none' as const,
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.5rem',
  },
  label: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    fontWeight: 500,
  },
  input: {
    width: '100%',
    padding: '0.6rem 0.75rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontSize: '0.9rem',
    outline: 'none',
  },
  footer: {
    padding: '1.25rem 1.5rem',
    borderTop: '1px solid var(--border-color)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'rgba(0,0,0,0.1)',
  },
  deleteBtn: {
    display: 'flex',
    alignItems: 'center',
    background: 'rgba(239, 68, 68, 0.1)',
    color: '#ef4444',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    padding: '0.5rem 1rem',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
    transition: 'all 0.2s',
  },
  cancelBtn: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-color)',
    padding: '0.5rem 1rem',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
  },
  saveBtn: {
    display: 'flex',
    alignItems: 'center',
    background: 'var(--accent-primary)',
    color: 'white',
    border: 'none',
    padding: '0.5rem 1.25rem',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
  }
};
