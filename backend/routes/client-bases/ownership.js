// Разделяемые хелперы клиент-баз (вынесены из client-bases.routes.js дословно).

export function makeLoadOwnedBase(supabase) {
    return async function loadOwnedBase(ownerId, baseId) {
        const { data: base, error } = await supabase
            .from('client_bases')
            .select('*')
            .eq('id', baseId)
            .eq('owner_id', ownerId)
            .single();
        if (error || !base) return null;
        return base;
    };
}

// Экранируем спецсимволы парсера PostgREST внутри значения для .or().
// Запятая и скобки режут условие на куски: «Смирнов, Иван» без экранирования
// превращается в два битых фильтра, «Иванов (старый)» — в мусорное вложенное выражение.
// Бэкслеши PostgREST в unquoted-значениях не поддерживает (проверено живьём, PGRST100),
// работает только двойное кавычкирование значения: ilike."%...%".
export function escapePostgrestOr(value) {
    return `"%${String(value).replace(/"/g, '\\"')}%"`;
}
