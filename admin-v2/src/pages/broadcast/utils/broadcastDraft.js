const ACTIVE_PREPARATION_STATUSES = new Set(['pending', 'scanning', 'joining', 'recomputing']);

const MEMBERS_PAGE_SIZE = 25;

function loadManualSelection() {
  try {
    const raw = window.localStorage.getItem('broadcast_manual_selection');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function consumeManualSelection() {
  const selection = loadManualSelection();
  if (selection) {
    window.localStorage.removeItem('broadcast_manual_selection');
  }
  return selection;
}

function loadDraft() {
  try {
    const raw = window.localStorage.getItem('broadcast_draft');
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      return {
        title: typeof parsed.title === 'string' ? parsed.title : '',
        base: typeof parsed.base === 'string' ? parsed.base : '',
        message_text: typeof parsed.message_text === 'string' ? parsed.message_text : '',
        leave_groups_on_complete: parsed.leave_groups_on_complete === true
      };
    }
  } catch {
    // черновик испорчен — игнорируем
  }
  return null;
}

function baseValueFromPreparation(prep) {
  if (!prep) return '';
  if (prep.audience_type === 'client_base_members' && prep.base_id) return `client:${prep.base_id}`;
  if (prep.audience_type === 'channel_audience_members' && prep.base_id) return `aud:${prep.base_id}`;
  if (prep.audience_type === 'manual_list') return 'manual';
  return '';
}

export {
  ACTIVE_PREPARATION_STATUSES,
  MEMBERS_PAGE_SIZE,
  loadManualSelection,
  consumeManualSelection,
  loadDraft,
  baseValueFromPreparation
};
