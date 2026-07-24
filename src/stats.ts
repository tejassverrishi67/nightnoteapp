export interface WeeklyData {
  day: string;
  consistency: number;
  focus: number;
  planned: number;
  completed: number;
  highPriorityPlanned: number;
  highPriorityCompleted: number;
}

export interface ProgressStats {
  tasksDone: number;
  streak: number;
  notes: number;
  lastMissionCompleteDate: string;
  lastNoteDate: string;
  weeklyData: WeeklyData[];
  weeklyInsight: string;
  deepFocus: number;
  followThrough: number;
  planningRealism: number;
  consistencyScore: number;
  activeDates: string[];
}

const DEFAULT_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function createDefaultWeeklyData(): WeeklyData[] {
  return DEFAULT_WEEKDAYS.map((d) => ({
    day: d,
    consistency: 0,
    focus: 0,
    planned: 0,
    completed: 0,
    highPriorityPlanned: 0,
    highPriorityCompleted: 0,
  }));
}

export const DEFAULT_STATS: ProgressStats = {
  tasksDone: 0,
  streak: 0,
  notes: 0,
  lastMissionCompleteDate: '',
  lastNoteDate: '',
  weeklyData: createDefaultWeeklyData(),
  weeklyInsight: 'Complete your first night note to begin tracking your consistency and focus.',
  deepFocus: 0,
  followThrough: 0,
  planningRealism: 0,
  consistencyScore: 0,
  activeDates: [],
};

export function getStats(): ProgressStats {
  try {
    const stored = localStorage.getItem('progressStats');
    if (stored) {
      const parsed = JSON.parse(stored);
      const merged: ProgressStats = {
        ...DEFAULT_STATS,
        ...parsed,
        weeklyData: Array.isArray(parsed.weeklyData) && parsed.weeklyData.length === 7
          ? parsed.weeklyData.map((d: any, idx: number) => ({
              day: DEFAULT_WEEKDAYS[idx] || d.day,
              consistency: Number(d.consistency) || 0,
              focus: Number(d.focus) || 0,
              planned: Number(d.planned) || 0,
              completed: Number(d.completed) || 0,
              highPriorityPlanned: Number(d.highPriorityPlanned) || 0,
              highPriorityCompleted: Number(d.highPriorityCompleted) || 0,
            }))
          : createDefaultWeeklyData(),
      };

      // Validate streak against dates
      merged.streak = validateStreak(merged);
      // Ensure metrics are calculated accurately
      recalculateStatsMetrics(merged);
      return merged;
    }
  } catch (e) {
    console.error('Failed to parse progress stats:', e);
  }
  return { ...DEFAULT_STATS, weeklyData: createDefaultWeeklyData() };
}

export function saveStats(stats: ProgressStats) {
  try {
    localStorage.setItem('progressStats', JSON.stringify(stats));
  } catch (e) {
    console.error('Failed to save progress stats:', e);
  }
}

function getTodayAndYesterday() {
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  const shortDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayDayName = shortDayNames[now.getDay()];

  return { todayStr, yesterdayStr, todayDayName };
}

function validateStreak(stats: ProgressStats): number {
  if (!stats.lastMissionCompleteDate) return 0;

  const { todayStr, yesterdayStr } = getTodayAndYesterday();

  if (stats.lastMissionCompleteDate === todayStr || stats.lastMissionCompleteDate === yesterdayStr) {
    return Math.max(1, stats.streak || 1);
  }

  // Older than yesterday: streak has broken
  return 0;
}

function recalculateStatsMetrics(stats: ProgressStats) {
  let totalPlanned = 0;
  let totalCompleted = 0;
  let totalHpPlanned = 0;
  let totalHpCompleted = 0;
  let activeDays = 0;

  stats.weeklyData.forEach((d) => {
    totalPlanned += d.planned || 0;
    totalCompleted += d.completed || 0;
    totalHpPlanned += d.highPriorityPlanned || 0;
    totalHpCompleted += d.highPriorityCompleted || 0;

    if ((d.planned || 0) > 0 || (d.completed || 0) > 0) {
      activeDays += 1;
    }
  });

  // Calculate Deep Focus score: (High Priority Completed / High Priority Planned) * 100
  if (totalHpPlanned > 0) {
    stats.deepFocus = Math.min(100, Math.round((totalHpCompleted / totalHpPlanned) * 100));
  } else if (totalPlanned > 0) {
    stats.deepFocus = Math.min(100, Math.round((totalCompleted / totalPlanned) * 100));
  } else {
    stats.deepFocus = 0;
  }

  // Calculate Follow-Through score: (Completed / Planned) * 100
  if (totalPlanned > 0) {
    stats.followThrough = Math.min(100, Math.round((totalCompleted / totalPlanned) * 100));
  } else {
    stats.followThrough = 0;
  }

  // Calculate Planning Realism score: based on optimal 3-5 tasks/day
  if (totalPlanned > 0 && activeDays > 0) {
    const avgPlannedPerDay = totalPlanned / activeDays;
    // Ideal count is 4. Deviations reduce score from 100%.
    const score = Math.max(20, Math.round(100 - Math.abs(avgPlannedPerDay - 4) * 12));
    stats.planningRealism = Math.min(100, score);
  } else {
    stats.planningRealism = 0;
  }

  // Calculate Consistency Score: (Active days in 7-day week / 7) * 100
  stats.consistencyScore = Math.round((activeDays / 7) * 100);

  // Default dynamic insight string if no insight set
  if (!stats.weeklyInsight || stats.weeklyInsight.startsWith('Complete your first')) {
    stats.weeklyInsight = generateLocalWeeklySummary(stats);
  }
}

export function generateLocalWeeklySummary(stats: ProgressStats): string {
  if (stats.tasksDone > 0) {
    const highFocusNote = stats.deepFocus >= 70 ? ' High focus work was prioritized.' : '';
    const streakNote = stats.streak > 0 ? ` Maintaining a ${stats.streak}-day streak.` : '';
    return `You have completed ${stats.tasksDone} total tasks across ${stats.notes} night notes.${highFocusNote}${streakNote}`;
  }

  if (stats.notes > 0) {
    return `You have created ${stats.notes} night note${stats.notes > 1 ? 's' : ''}. Check off your morning tasks to boost your execution skills!`;
  }

  return 'Complete your first night note to begin tracking your consistency and focus.';
}

export function incrementNotes(): ProgressStats {
  const stats = getStats();
  const { todayStr } = getTodayAndYesterday();

  stats.notes += 1;
  stats.lastNoteDate = todayStr;

  if (!stats.activeDates.includes(todayStr)) {
    stats.activeDates.push(todayStr);
  }

  stats.weeklyInsight = generateLocalWeeklySummary(stats);
  saveStats(stats);
  return stats;
}

export function recordTaskActivity(tasks: any[]): ProgressStats {
  const stats = getStats();
  const { todayStr, todayDayName } = getTodayAndYesterday();

  const dayIndex = stats.weeklyData.findIndex((d) => d.day === todayDayName);
  if (dayIndex !== -1) {
    const planned = tasks.length;
    const completed = tasks.filter((t: any) => t.done).length;
    const highPriorityPlanned = tasks.filter((t: any) => t.priority === 'high').length;
    const highPriorityCompleted = tasks.filter((t: any) => t.priority === 'high' && t.done).length;

    stats.weeklyData[dayIndex].planned = planned;
    stats.weeklyData[dayIndex].completed = completed;
    stats.weeklyData[dayIndex].highPriorityPlanned = highPriorityPlanned;
    stats.weeklyData[dayIndex].highPriorityCompleted = highPriorityCompleted;

    stats.weeklyData[dayIndex].consistency = planned > 0 ? Math.min(100, Math.round((completed / planned) * 100)) : 0;
    stats.weeklyData[dayIndex].focus = highPriorityPlanned > 0
      ? Math.min(100, Math.round((highPriorityCompleted / highPriorityPlanned) * 100))
      : stats.weeklyData[dayIndex].consistency;
  }

  // Calculate tasksDone as cumulative total completed across weeklyData
  const weekCompletedTotal = stats.weeklyData.reduce((acc, d) => acc + (d.completed || 0), 0);
  stats.tasksDone = Math.max(stats.tasksDone, weekCompletedTotal);

  if (!stats.activeDates.includes(todayStr) && tasks.some((t: any) => t.done)) {
    stats.activeDates.push(todayStr);
  }

  recalculateStatsMetrics(stats);
  stats.weeklyInsight = generateLocalWeeklySummary(stats);

  saveStats(stats);
  return stats;
}

export function recordMissionComplete(tasksCompleted: number, todayStr: string, todayDayName: string): ProgressStats {
  const stats = getStats();
  const { yesterdayStr } = getTodayAndYesterday();

  if (stats.lastMissionCompleteDate !== todayStr) {
    if (stats.lastMissionCompleteDate === yesterdayStr) {
      stats.streak += 1;
    } else {
      stats.streak = 1;
    }
    stats.lastMissionCompleteDate = todayStr;
  }

  if (!stats.activeDates.includes(todayStr)) {
    stats.activeDates.push(todayStr);
  }

  recalculateStatsMetrics(stats);
  stats.weeklyInsight = generateLocalWeeklySummary(stats);

  saveStats(stats);
  return stats;
}
