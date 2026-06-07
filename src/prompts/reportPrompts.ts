export const buildWeeklyReportPrompt = (minutesText: string, templateText?: string) => {
  const templateInstruction = templateText
    ? `以下のテンプレートのフォーマットに厳密に従って出力してください。\n\n【出力テンプレート】\n${templateText}\n\n`
    : '今週の週報（サマリー、主な進捗、次週の課題）をマークダウン形式で作成してください。\n\n';

  return `以下の今週の複数の会議議事録要約を元に、週報を作成してください。

${templateInstruction}

【記述のレイアウト・フォーマットに関する重要指示】
- 週報内にテキストを記述する際は、1行あたり半角70文字（全角35文字）程度で適切に改行（折り返し）を行ってください。
- 改行する際は、その項目や箇条書きのインデント（行頭の半角スペースによるインデント幅）を崩さず、開始位置（インデント）を揃えて次の行を書き出してください。
  （例：行頭に半角スペース4つのインデントがある場合は、折り返した後の行も同様に半角スペース4つ分を空けて開始する）

【議事録要約群】
${minutesText}`;
};

export const WEEKLY_REPORT_TEMPLATE = `【秘密】関係者外秘

TO:若松さん、川畑さん

週報を送付いたします。

週報
  チーム／個人名：川畑チーム／曽根 雄太
  期間： <yyyy/mm/dd〜yyyy/mm/dd>

----------+----------+----------+----------+----------+----------+----------

1. トピックス
  特になし

2. 課題・クレーム
  特になし

3. 依頼事項・阻害要因
  特になし

4. 営業状況
  特になし

5. PJ遂行状況
<PJ遂行状況エリア>

6. 共通活動
  ○人材育成
    特になし

  ○調査研究活動
    特になし

  ○採用活動
    特になし

  ○広報活動
    特になし

  ○オファリング／サービスメニュー開発活動
    特になし

7. その他
  ○稼働状況
    今月以降：下記プロジェクトで8割以上埋まる予定
<稼働状況エリア>

  ○20%ルール活動
    特になし

  ○自己啓発
    特になし

8. 次週の予定（トピックス）
  特になし

9. その他、所感
  <何でもよいので必ず書いて頂けると有難いです。勿論業務外の内容でもOKです。>

----------+----------+----------+----------+----------+----------+----------

----------+----------+----------+----------+----------+----------+----------`;

export interface ProjectLike {
  id: string;
  name: string;
  stakeholders?: string[];
  isClosed?: boolean;
}

export interface TeamMemberLike {
  id: string;
  name: string;
  group: string;
  title?: string;
  isInternal?: boolean;
  order?: number;
}

export const buildWeeklyReportTxt = (projects: ProjectLike[], members: TeamMemberLike[]) => {
  // 1. Calculate Monday and Friday of the current week (JST preferred, but we can do local)
  const today = new Date();
  const currentDay = today.getDay();
  // Monday is 1, Sunday is 0.
  const mondayDiff = currentDay === 0 ? -6 : 1 - currentDay;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayDiff);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const formatDate = (date: Date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd}`;
  };

  const periodStr = `${formatDate(monday)}〜${formatDate(friday)}`;

  // Helper to get last name (split by space or full-width space)
  const getLastName = (fullName: string) => {
    return fullName.trim().split(/[\s　]+/)[0] || fullName;
  };

  const memberMap = new Map<string, TeamMemberLike>(members.map(m => [m.id, m]));

  // 2. For PJ遂行状況 (exclude closed and 間接作業)
  const activeProjects = projects.filter(pj => !pj.isClosed && pj.name !== '間接作業');
  const pjSections: string[] = [];
  activeProjects.forEach(pj => {
    // get assignees of this project that are internal
    const assignedInternalMembers = (pj.stakeholders || [])
      .map(id => memberMap.get(id))
      .filter((m): m is TeamMemberLike => !!m && !!m.isInternal)
      // Sort by group then order
      .sort((a, b) => {
        const groupA = a.group || '未分類';
        const groupB = b.group || '未分類';
        if (groupA !== groupB) return groupA.localeCompare(groupB);
        return (a.order ?? 9999) - (b.order ?? 9999);
      });

    const assigneeNames = assignedInternalMembers
      .map(m => `${getLastName(m.name)}${m.title || ''}`)
      .join('、');

    pjSections.push(`  ○${pj.name}（${assigneeNames || '未定'}）
    状況：
      <3~5行程度で>`);
  });

  const pjStatusText = pjSections.length > 0 ? pjSections.join('\n\n') : '  特になし';

  // 3. For 稼働状況 (also exclude closed and 間接作業)
  const runningPjs = activeProjects.map(pj => `    ・${pj.name}`).join('\n');
  const workloadText = runningPjs || '    ・特になし';

  // 4. Replace placeholders
  let content = WEEKLY_REPORT_TEMPLATE;
  content = content.replace('<yyyy/mm/dd〜yyyy/mm/dd>', periodStr);
  
  // Replace the entire block or placeholder for PJ遂行状況
  const targetPjPlaceholder = `  ○<PJ名>（<割り当て担当者一覧>）\n    状況：\n      <3~5行程度で>`;
  if (content.includes(targetPjPlaceholder)) {
    content = content.replace(targetPjPlaceholder, pjStatusText);
  } else {
    content = content.replace('<PJ遂行状況エリア>', pjStatusText);
  }

  // Replace the placeholder for 稼働状況
  const targetWorkloadPlaceholder = `    ・<PJ名>`;
  if (content.includes(targetWorkloadPlaceholder)) {
    content = content.replace(targetWorkloadPlaceholder, workloadText);
  } else {
    content = content.replace('<稼働状況エリア>', workloadText);
  }

  return content;
};
