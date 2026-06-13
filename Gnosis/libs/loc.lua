FF_CLIENT_LANG = 'en'

local function detect_lang()
    local ok, info = pcall(windower.ffxi.get_info)
    if not ok or type(info) ~= 'table' then return 'en' end
    local lang = info.language
    if type(lang) ~= 'string' then return 'en' end
    return lang:lower() == 'japanese' and 'ja' or 'en'
end

function ff_loc_refresh()
    FF_CLIENT_LANG = detect_lang()
end

ff_loc_refresh()

windower.register_event('login', ff_loc_refresh)
windower.register_event('load',  ff_loc_refresh)

function ff_loc_name(entry, fallback)
    if type(entry) ~= 'table' then return fallback end
    if FF_CLIENT_LANG == 'ja' then
        return entry.ja or entry.japanese or entry.en or entry.english or fallback
    end
    return entry.en or entry.english or entry.ja or entry.japanese or fallback
end

function ff_loc_name_en(entry, fallback)
    if type(entry) ~= 'table' then return fallback end
    return entry.en or entry.english or fallback
end

function ff_loc_zone(zone_id, fallback)
    if not zone_id or not res or not res.zones then return fallback end
    return ff_loc_name(res.zones[zone_id], fallback)
end

function ff_loc_item(item_id, fallback)
    if not item_id or not res or not res.items then return fallback end
    return ff_loc_name(res.items[item_id], fallback)
end

function ff_loc_spell(spell_id, fallback)
    if not spell_id or not res or not res.spells then return fallback end
    return ff_loc_name(res.spells[spell_id], fallback)
end

function ff_loc_ability(ability_id, fallback)
    if not ability_id or not res or not res.job_abilities then return fallback end
    return ff_loc_name(res.job_abilities[ability_id], fallback)
end

function ff_loc_ws(ws_id, fallback)
    if not ws_id or not res or not res.weapon_skills then return fallback end
    return ff_loc_name(res.weapon_skills[ws_id], fallback)
end

function ff_loc_buff(buff_id, fallback)
    if not buff_id or not res or not res.buffs then return fallback end
    return ff_loc_name(res.buffs[buff_id], fallback)
end

function ff_loc_ki(ki_id, fallback)
    if not ki_id or not res or not res.key_items then return fallback end
    return ff_loc_name(res.key_items[ki_id], fallback)
end

function ff_loc_monster_ability(id, fallback)
    if not id or not res then return fallback end
    if res.monster_abilities and res.monster_abilities[id] then return ff_loc_name(res.monster_abilities[id], fallback) end
    if res.monster_skills    and res.monster_skills[id]    then return ff_loc_name(res.monster_skills[id], fallback) end
    return fallback
end
