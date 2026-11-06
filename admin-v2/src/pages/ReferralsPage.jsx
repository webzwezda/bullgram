import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { isPayoutEvent } from './referrals/components/TransferBoxes.jsx';
import { DashboardTables } from './referrals/sections/DashboardTables.jsx';
import { PrioritySignals } from './referrals/sections/PrioritySignals.jsx';
import { ReserveCard } from './referrals/sections/ReserveCard.jsx';

export function ReferralsPage() {
  const { accessToken, profileRole } = useAuth();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [settingsDraft, setSettingsDraft] = useState({
    referral_enabled: false,
    referral_reward_percent: 20,
    referral_client_discount_percent: 10,
    referral_welcome_text: ''
  });
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    savingSettings: false,
    payouting: false,
    refunding: false,
    error: '',
    settings: null,
    summary: {},
    topPartners: [],
    leads: [],
    pendingPayouts: [],
    recentEvents: [],
    support: {},
    reserve: null,
    economics: {},
    updatedAt: null
  });
  const canEnableReferrals = !!state.reserve?.canEnableReferrals || profileRole === 'admin';

  useEffect(() => {
    let cancelled = false;

    async function loadReferrals({ silent = false } = {}) {
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.topPartners.length,
          refreshing: !!prev.topPartners.length,
          error: ''
        }));
      }

      try {
        const data = await apiRequest('/api/referrals', { accessToken });
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            savingSettings: false,
            payouting: false,
            refunding: false,
            error: '',
            settings: data.settings || null,
            summary: data.summary || {},
            topPartners: data.topPartners || [],
            leads: data.leads || [],
            pendingPayouts: data.pendingPayouts || [],
            recentEvents: data.recentEvents || [],
            support: data.support || {},
            reserve: data.reserve || null,
            economics: data.economics || {},
            updatedAt: new Date().toISOString()
          });
          setSettingsDraft({
            referral_enabled: !!data.settings?.referral_enabled,
            referral_reward_percent: Number(data.settings?.referral_reward_percent ?? 20),
            referral_client_discount_percent: Number(data.settings?.referral_client_discount_percent ?? data.economics?.clientDiscountPercent ?? 10),
            referral_welcome_text: data.settings?.referral_welcome_text || ''
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            savingSettings: false,
            payouting: false,
            refunding: false,
            error: error.message,
            settings: null,
            summary: {},
            topPartners: [],
            leads: [],
            pendingPayouts: [],
            recentEvents: [],
            support: {},
            reserve: null,
            economics: {},
            updatedAt: null
          });
        }
      }
    }

    if (accessToken) {
      loadReferrals();
    }

    const intervalId = accessToken
      ? window.setInterval(() => {
          loadReferrals({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken]);
  const filteredPartners = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let rows = state.topPartners;

    if (filter === 'with_balance') {
      rows = rows.filter((row) => Number(row.balance_rub) > 0 || Number(row.balance_ton) > 0 || Number(row.balance_usdt) > 0);
    } else if (filter === 'rewards') {
      rows = rows.filter((row) => Number(row.earnedRub) > 0 || Number(row.earnedTon) > 0 || Number(row.earnedUsdt) > 0);
    } else if (filter === 'payouts') {
      rows = rows.filter((row) => (
        Number(row.pending_payout_ton) > 0 ||
        Number(row.paid_out_rub) > 0 ||
        Number(row.paid_out_ton) > 0 ||
        Number(row.paid_out_usdt) > 0
      ));
    }

    if (!needle) return rows;

    return rows.filter((row) => [
      row.tg_user_id,
      row.username || '',
      row.display_name || '',
      row.referral_code || ''
    ].join(' ').toLowerCase().includes(needle));
  }, [filter, search, state.topPartners]);

  const filteredLeads = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let rows = state.leads;

    if (filter === 'rewards') {
      rows = rows.filter((row) => row.converted || row.reward_status);
    } else if (filter === 'payouts') {
      rows = [];
    }

    if (!needle) return rows;

    return rows.filter((row) => [
      row.referred_tg_user_id,
      row.referred_username || '',
      row.referred_display_name || '',
      row.referrer_tg_user_id || '',
      row.referrer_username || '',
      row.referrer_display_name || '',
      row.referral_code || ''
    ].join(' ').toLowerCase().includes(needle));
  }, [filter, search, state.leads]);

  const filteredEvents = useMemo(() => {
    if (filter === 'rewards') {
      return state.recentEvents.filter((event) => event.event_type === 'reward_granted');
    }
    if (filter === 'payouts') {
      return state.recentEvents.filter(isPayoutEvent);
    }
    return state.recentEvents;
  }, [filter, state.recentEvents]);
  async function saveSettings() {
    setState((prev) => ({ ...prev, savingSettings: true, error: '' }));
    try {
      await apiRequest('/api/referrals/settings', {
        accessToken,
        method: 'POST',
        body: settingsDraft
      });
      setState((prev) => ({
        ...prev,
        savingSettings: false,
        settings: { ...settingsDraft },
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, savingSettings: false, error: error.message }));
    }
  }

  async function refreshReferralState(extra = {}) {
    const data = await apiRequest('/api/referrals', { accessToken });
    setState((prev) => ({
      ...prev,
      ...extra,
      settings: data.settings || prev.settings,
      summary: data.summary || prev.summary,
      topPartners: data.topPartners || prev.topPartners,
      leads: data.leads || prev.leads,
      pendingPayouts: data.pendingPayouts || [],
      recentEvents: data.recentEvents || prev.recentEvents,
      support: data.support || prev.support,
      reserve: data.reserve || prev.reserve,
      economics: data.economics || prev.economics,
      updatedAt: new Date().toISOString()
    }));
  }
  if (state.loading) {
    return <LoadingState text="Загружаем рефералку..." />;
  }

  if (state.error) {
    return (
      <section className="page page--flush">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        </div>
        <div className="p-4 bg-red-50 text-red-700 rounded-2xl border border-red-100 font-medium">{state.error}</div>
      </section>
    );
  }
  return (
    <section className="page page--flush">
      {/* Main Content Card */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 p-6 sm:p-10 lg:p-12">
        
        <div className="space-y-12">
          
          <ReserveCard accessToken={accessToken} state={state} setState={setState} refreshReferralState={refreshReferralState} />

          <div className="h-px bg-slate-100" />

          {/* STEP 2: SETTINGS */}
          <section className="space-y-8">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-sm font-black shadow-md shadow-indigo-600/20">
                2
              </div>
              <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Настройки партнерки</h2>
              <p className="text-slate-500 font-medium text-xs">Управление экономикой и активация</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">Статус программы</label>
                  <div className="relative">
                    <select
                      className="w-full pl-4 pr-11 py-3.5 bg-white border border-slate-300 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all appearance-none cursor-pointer"
                      value={settingsDraft.referral_enabled ? 'yes' : 'no'}
                      onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_enabled: event.target.value === 'yes' }))}
                    >
                      <option value="no">Выключена</option>
                      <option value="yes" disabled={!canEnableReferrals}>Включена</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">Награда партнера, %</label>
                  <div className="relative">
                    <input
                      className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                      type="number"
                      min="0"
                      max="100"
                      value={settingsDraft.referral_reward_percent}
                      onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_reward_percent: Number(event.target.value || 0) }))}
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">%</div>
                  </div>
                </div>

                <div className="space-y-2 group">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">Скидка клиенту</label>
                  <div className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-400 font-bold opacity-60 cursor-not-allowed">
                    {settingsDraft.referral_client_discount_percent || 10}%
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">Bullgram Fee</label>
                  <div className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-400 font-bold opacity-60 cursor-not-allowed">
                    {state.economics?.bullgramFeePercent || 1}%
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 h-full">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">Приветствие для партнеров</label>
                <textarea
                  className="w-full h-full flex-1 px-5 py-4 bg-slate-50 border border-slate-200 rounded-[1.5rem] text-slate-900 font-medium focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all min-h-[140px] resize-none shadow-inner"
                  value={settingsDraft.referral_welcome_text}
                  onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_welcome_text: event.target.value }))}
                  placeholder="Добро пожаловать в партнерскую программу! Ваша реферальная ссылка готова..."
                />
              </div>
            </div>
          </section>
          <PrioritySignals state={state} profileRole={profileRole} />
        </div>

        {/* Action Bar */}
        <div className="mt-12 pt-8 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            className="group relative inline-flex items-center justify-center gap-3 rounded-2xl bg-slate-900 px-10 py-4 text-base font-black text-white shadow-xl shadow-slate-900/20 transition-all hover:bg-slate-800 hover:-translate-y-1 active:scale-95 disabled:opacity-50 disabled:translate-y-0"
            onClick={saveSettings}
            disabled={state.savingSettings}
          >
            {state.savingSettings ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Сохраняем...
              </span>
            ) : (
              <>
                Сохранить настройки
                <ArrowRight className="w-5 h-5 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* DASHBOARD TABLES SECTION */}
      <DashboardTables accessToken={accessToken} state={state} setState={setState} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} filteredPartners={filteredPartners} filteredLeads={filteredLeads} filteredEvents={filteredEvents} />
    </section>
  );
}
