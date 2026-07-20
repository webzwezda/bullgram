export async function claimPaid({ supabase, table, id, patch, statusField = 'status', pendingValue = 'pending' }) {
  if (!supabase) throw new Error('claimPaid: supabase is required');
  if (!table) throw new Error('claimPaid: table is required');
  if (!id) throw new Error('claimPaid: id is required');

  const { data, error } = await supabase
    .from(table)
    .update(patch)
    .eq('id', id)
    .eq(statusField, pendingValue)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function markExpired({ supabase, table, id, patch = {}, statusField = 'status', pendingValue = 'pending' }) {
  return claimPaid({
    supabase,
    table,
    id,
    patch: { [statusField]: 'expired', updated_at: new Date().toISOString(), ...patch },
    statusField,
    pendingValue
  });
}
