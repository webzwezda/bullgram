export async function transferShopAssets(supabase, purchase, item, assets) {
    const buyerOwnerId = purchase.buyer_owner_id;
    const sellerOwnerId = purchase.seller_owner_id;

    const includedProxyIds = new Set(
        assets.filter(asset => asset.asset_type === 'proxy').map(asset => String(asset.asset_id))
    );

    for (const asset of assets) {
        if (asset.asset_type === 'proxy') {
            const updatePayload = { owner_id: buyerOwnerId };
            const { error: supportError } = await supabase
                .from('proxies')
                .select('provision_source')
                .limit(1);
            if (!supportError) {
                updatePayload.provision_source = 'purchased';
            }

            const { error } = await supabase
                .from('proxies')
                .update(updatePayload)
                .eq('id', asset.asset_id)
                .eq('owner_id', sellerOwnerId);
            if (error) throw error;
            continue;
        }

        if (asset.asset_type === 'userbot') {
            const { data: account, error: accountError } = await supabase
                .from('tg_accounts')
                .select('id, proxy_id')
                .eq('id', asset.asset_id)
                .eq('owner_id', sellerOwnerId)
                .eq('account_type', 'userbot')
                .single();
            if (accountError) throw accountError;

            const updatePayload = {
                owner_id: buyerOwnerId
            };

            if (account.proxy_id && !includedProxyIds.has(String(account.proxy_id))) {
                updatePayload.proxy_id = null;
            }

            const { error } = await supabase
                .from('tg_accounts')
                .update(updatePayload)
                .eq('id', account.id);
            if (error) throw error;
            continue;
        }

        if (asset.asset_type === 'channel_audience_asset') {
            const { error: baseError } = await supabase
                .from('channel_audiences')
                .update({ owner_id: buyerOwnerId })
                .eq('id', asset.asset_id)
                .eq('owner_id', sellerOwnerId);
            if (baseError) throw baseError;

            const { error: membersError } = await supabase
                .from('channel_audience_members')
                .update({ owner_id: buyerOwnerId })
                .eq('base_id', asset.asset_id)
                .eq('owner_id', sellerOwnerId);
            if (membersError && !(membersError.message || '').includes('channel_audience_members')) {
                throw membersError;
            }
        }
    }

    await supabase
        .from('shop_items')
        .update({
            status: 'sold',
            visibility: 'private',
            updated_at: new Date().toISOString()
        })
        .eq('id', item.id);
}
