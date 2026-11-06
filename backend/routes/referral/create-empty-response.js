import { getReferralEconomics } from '../../services/referral-reserve.service.js';
import { getReferralPayoutSenderSafetyConfig } from '../../services/referral-payout-sender.service.js';
import { getTonReserveSenderConfig } from '../../services/ton-reserve-sender.service.js';
import { getReferralRefundSenderConfig } from '../../services/referral-refund-sender.service.js';

export function createEmptyResponse() {
    return {
        settings: {
            referral_enabled: false,
            referral_reward_percent: 20,
            referral_welcome_text: ''
        },
        summary: {
            partners: 0,
            leads: 0,
            paidReferrals: 0,
            earnedRub: 0,
            earnedTon: 0,
            earnedUsdt: 0,
            outstandingRub: 0,
            outstandingTon: 0,
            outstandingUsdt: 0,
            paidOutRub: 0,
            paidOutTon: 0,
            paidOutUsdt: 0
        },
        topPartners: [],
        leads: [],
        pendingPayouts: [],
        recentEvents: [],
        support: {
            referralTables: true,
            referralSettings: true,
            automaticPayoutSender: getTonReserveSenderConfig().enabled,
            automaticPayoutSenderMaxAmountTon: getReferralPayoutSenderSafetyConfig().maxAutoPayoutTon,
            automaticRefundSender: getReferralRefundSenderConfig().enabled
        },
        reserve: null,
        economics: getReferralEconomics()
    };
}
