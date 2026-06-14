_addon.name = 'Gnosis'
_addon.author = 'Noirblanc'
_addon.version = '0.0.0'
_addon.commands = {'gnosis', 'gn'}

require('chat')
require('logger')
packets = require('packets')
res = require('resources')
currency = require('currency')

ff_url   = "https://gnosis-xi.com"

auto_report    = true
sortie_capture = 'full'

https = require("ssl.https")
ltn12 = require("ltn12")
package.path = package.path .. ';' .. windower.addon_path .. 'libs/?.lua'
json = require('dkjson')

GN_C_BRACKET = '\31\200'   -- gray
GN_C_TITLE   = '\31\08'    -- amber (brand accent)
GN_C_BODY    = '\31\207'   -- light
GN_C_OK      = '\31\06'    -- green
GN_C_WARN    = '\31\08'    -- amber
GN_C_ERR     = '\31\03'    -- red
GN_PREFIX    = GN_C_BRACKET..'['..GN_C_TITLE..'Gnosis'..GN_C_BRACKET..']'..GN_C_BODY..' '
function gn_chat(body)      windower.add_to_chat(207, GN_PREFIX..body) end
function gn_chat_warn(body) windower.add_to_chat(207, GN_PREFIX..GN_C_WARN..body) end
function gn_chat_err(body)  windower.add_to_chat(207, GN_PREFIX..GN_C_ERR..body) end

dofile(windower.addon_path .. 'libs/entity_class.lua')

dofile(windower.addon_path .. 'libs/loc.lua')

dofile(windower.addon_path .. 'libs/log_builders.lua')

-- Shared report serialization / file write / upload / Discord pipeline.
dofile(windower.addon_path .. 'libs/report_io.lua')

-- Disk-streamed per-log append writer. Background coroutine polls the active
-- encounter's log tables every 5 s and appends new entries to .partial files
-- on disk. Save time only handles the small scalar fields + file copy.
log_writer = require('log_writer')

-- Filesystem-safe zone name: Windows reserves <>:"/\|?* and control chars.
-- FFXI zone names use single quotes (Ra'Kaznar), brackets ([U2]), and spaces,
-- all of which are valid on Windows.
function gn_zone_path_segment(name)
    if not name or name == '' then return 'Unknown' end
    return (name:gsub('[<>:"/\\|?*]', '_'))
end

-- Create a directory if missing. No-op if it already exists.
function gn_ensure_dir(path)
    if windower.dir_exists and not windower.dir_exists(path) then
        windower.create_dir(path)
    end
end

-- Partials live in data/_partials/ regardless of which zone the encounter
-- ends up filed under. They're addon-internal working files; the final .json
-- lives in its zone folder.
GN_PARTIALS_DIR = windower.addon_path .. 'data/_partials'

-- Field-name 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｲ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・､鬯ｮ・ｫ繝ｻ・ｲ髫ｶ蜴・ｽｽ・ｸ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｺ鬯ｮ・ｫ繝ｻ・ｨ郢晢ｽｻ繝ｻ・ｳ鬮ｯ・ｷ・つ髫ｴ莨夲ｽｽ・ｦ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｹ鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｮ・ｯ隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｫ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｮ繝ｻ・ｮ髫ｲ蟷｢・ｽ・ｶ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｣鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻsource-field-name map used by log_writer when polling. Top-
-- level field on the saved report 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｲ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・､鬯ｮ・ｫ繝ｻ・ｲ髫ｶ蜴・ｽｽ・ｸ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｺ鬯ｮ・ｫ繝ｻ・ｨ郢晢ｽｻ繝ｻ・ｳ鬮ｯ・ｷ・つ髫ｴ莨夲ｽｽ・ｦ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｹ鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｮ・ｯ隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｫ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｮ繝ｻ・ｮ髫ｲ蟷｢・ｽ・ｶ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｣鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻsource-table field name. Single source of
-- truth so Sortie and generic see the same shape.
GN_LOG_MAP = {
    actionLog        = 'action_log',
    positionLog      = 'position_log',
    partyHpLog       = 'party_hp_log',
    partyTpLog       = 'party_tp_log',
    partyMpLog       = 'party_mp_log',
    buffLog          = 'buff_log',
    skillchainLog    = 'skillchain_log',
    battleMsgRaw     = 'battle_msg_raw',
    jobExtendedLog   = 'job_extended_log',
    effectLog        = 'effect_log',
    bossHpLog        = 'boss_hp_log',
    killLog          = 'kill_log',
    itemUseLog       = 'item_use_log',
    petLog           = 'pet_log',
    zoneLog          = 'zone_log',
    deathLog         = 'death_log',
    chestLog         = 'chest_log',
    miniNmLog        = 'mini_nm_log',
    dropLog          = 'drop_log',
    absorbTpLog      = 'absorb_tp_log',
    partyPositionLog = 'party_position_log',
    progressionLog   = 'progression_log',
    keyItemLog       = 'key_item_log',
}

-- One-time sweep of any leftover *.partial files from a previous crash or
-- addon reload. Scans both the new location (data/_partials/) AND the legacy
-- root (data/) so users upgrading from an older Gnosis don't accumulate
-- orphans in the old spot.
pcall(function()
    gn_ensure_dir(GN_PARTIALS_DIR)
    local removed = 0
    removed = removed + (log_writer.cleanup_orphans(GN_PARTIALS_DIR) or 0)
    removed = removed + (log_writer.cleanup_orphans(windower.addon_path .. 'data') or 0)
    if removed > 0 then
        gn_chat(('Cleaned up %d orphaned partial file(s).'):format(removed))
    end
end)

dofile(windower.addon_path .. 'libs/parse_import.lua')

-- Native combat-stat accumulation from the 'action' event, keyed by our own
-- resolved names 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｩ鬮ｯ譎｢・ｽ・ｷ郢晢ｽｻ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｴ鬯ｮ・ｮ隲幢ｽｶ繝ｻ・ｽ繝ｻ・｣驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｯ髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｷ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｮ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｮ鬮ｫ・ｲ陝ｷ・｢繝ｻ・ｽ繝ｻ・ｶ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｣鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻthe in-process source for parse_import's report builders.
dofile(windower.addon_path .. 'libs/combat_stats.lua')

dofile(windower.addon_path .. 'libs/live_state.lua')

dofile(windower.addon_path .. 'libs/points.lua')

-- Compact binary encounter format. Hand-off from the game-thread to the
-- desktop app, which converts to the canonical .json off-thread.
dofile(windower.addon_path .. 'libs/glog.lua')

-- Generic non-blocking HTTP helper.
dofile(windower.addon_path .. 'libs/net.lua')

-- Multibox data channel (streams this box's state to the desktop app).
dofile(windower.addon_path .. 'libs/styx_ipc.lua')


local _icon_ok, _icon_extractor = pcall(require, 'icon_extractor')
local _icon_dir    = windower.addon_path .. 'data/assets'
local _icon_prefix = _icon_dir .. '/icon_'
if _icon_ok then gn_ensure_dir(_icon_dir) end
local _icon_queue = {}
local _icon_drain_t = 0
function ff_queue_icon(id)
    if not _icon_ok or not id or id == 0 then return end
    if _icon_queue[id] then return end
    if windower.file_exists and windower.file_exists(_icon_prefix .. id .. '.bmp') then return end
    _icon_queue[id] = true
end
if _icon_ok then
    windower.register_event('prerender', function()
        local c = os.clock()
        if (c - _icon_drain_t) < 0.3 then return end
        _icon_drain_t = c
        local id = next(_icon_queue)
        if not id then return end
        _icon_queue[id] = nil
        coroutine.schedule(function() pcall(_icon_extractor.item_by_id, id, _icon_prefix .. id .. '.bmp') end, 0)
    end)
end


do
    local _cfg_f = io.open(windower.addon_path .. 'data/styx_config.json', 'r')
        or io.open(windower.addon_path .. 'data/flowerfield_config.json', 'r')
        or io.open(windower.addon_path .. 'data/incessantvoid_config.json', 'r')
    if _cfg_f then
        local _raw = _cfg_f:read('*all')
        _cfg_f:close()
        local _cfg = json.decode(_raw)
        if _cfg and _cfg.auto_report ~= nil then
            auto_report = _cfg.auto_report and true or false
        end
    end
end

local hm = false

local fight_start_time = nil
local fight_end_time = nil
party_jobs = {}
party_id_to_name = {}  -- entity ID -> most recently seen party member name (for rename dedup)
name_alias = {}
combat_stats = {}
ff_live_combat_stats = nil
ff_live_combat_start = nil

-- Boss fight timing (all sector bosses)
local boss_fight_start = {}
local boss_fight_end = {}
local in_sortie = false
local sortie_gear_token = nil   -- shared gear/state capture ownership token

local gallimaufry_total = 0
local starting_galli = 0 
local ending_galli = 0
local galli_total = 0

local drops = {
    sapphire     = 0,
    starstone    = 0,
    eikondrite   = 0,
    octahedrite  = 0,
    hexahedrite  = 0,
    mesosiderite = 0,
    oldCase      = 0,
    oldCasePlus1 = 0,
}

local meso_count = 0

local aminon_rolls = {
    ['Tactician\'s'] = {lucky = false, value = 0},
    ['Miser\'s'] =     {lucky = false, value = 0} 
}

local wild_card_roll = 0

local additional_note = "Nothing to add"

-- Objective and NM tracking
-- Bonus NM objective for each sector (one per sector A-H, full name 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｲ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・､鬯ｮ・ｫ繝ｻ・ｲ髫ｶ蜴・ｽｽ・ｸ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｺ鬯ｮ・ｫ繝ｻ・ｨ郢晢ｽｻ繝ｻ・ｳ鬮ｯ・ｷ・つ髫ｴ莨夲ｽｽ・ｦ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｹ鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｮ・ｯ隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｫ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｮ繝ｻ・ｮ髫ｲ蟷｢・ｽ・ｶ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｣鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻsector letter)
local BONUS_NM = {
    ['Abject Obdella']       = 'A',
    ['Biune Porxie']         = 'B',
    ['Cachaemic Bhoot']      = 'C',
    ['Demisang Deleterious'] = 'D',
    ['Esurient Botulus']     = 'E',
    ['Fetid Ixion']          = 'F',
    ['Gyvewrapped Naraka']   = 'G',
    ['Haughty Tulittia']     = 'H',
}
local boss_min_hp = {}  -- lowest HP% seen per tracked boss during fight, keyed by mob name

-- Sector bosses (excludes Aminon, which is tracked separately)
local sector_bosses = {'Ghatjot', 'Leshonn', 'Skomora', 'Degei', 'Dhartok', 'Gartell', 'Triboulex', 'Aita'}
local boss_sector_map = {Ghatjot='A', Leshonn='B', Skomora='C', Degei='D', Dhartok='E', Gartell='F', Triboulex='G', Aita='H'}

-- Naakual names (same 6 appear in each basement sector E-H)
local NAAKUAL_NAMES = {'Bztavian', 'Rockfin', 'Gabbrath', 'Waktza', 'Yggdreant', 'Cehuetzi'}
-- Per-sector kill timestamps (elapsed seconds from sortie start, nil = not yet killed)
local naakual_kills = { E={}, F={}, G={}, H={} }
local boss_starts_needed = 8  -- decremented as starts are detected; 0 = skip action-packet check

local track_target_set = {
    Ghatjot=true, Leshonn=true, Skomora=true, Degei=true,
    Dhartok=true, Gartell=true, Triboulex=true, Aita=true, Aminon=true
}

local aurum_chest = false
local naaks = 0
local aminon_defeated = false
local defeated_mini_nms = {}
local flans_killed = false

local opened_chests = {}  -- list of raw NPC packet IDs, for deduplication
local sector_objectives = { A=0, B=0, C=0, D=0, E=0, F=0, G=0, H=0 }

local WARP_ENTER = {
    [1005]='Boss A', [1006]='Boss B', [1007]='Boss C', [1008]='Boss D',
    [1010]='Sector E', [1011]='Sector F', [1012]='Sector G', [1013]='Sector H',
    [1018]='Boss E',  [1019]='Boss F',  [1020]='Boss G',  [1021]='Boss H',
    [1022]='Aminon',
}
local BOSS_EXIT_AREA = {
    ['Boss A']='Ground Floor', ['Boss B']='Ground Floor',
    ['Boss C']='Ground Floor', ['Boss D']='Ground Floor',
    ['Boss E']='Sector E', ['Boss F']='Sector F',
    ['Boss G']='Sector G', ['Boss H']='Sector H',
}
local WARP_EXIT_IDS = {[1014]=true,[1015]=true,[1016]=true,[1017]=true}
local boss_exit_menu_id  = 1009
local aminon_exit_menu_id = 1023
local aminon_exit_area    = 'Sector E'


-- Fetch warp/chest maps from the SortieStats server.
-- Runs once at load; silently falls back to defaults above if unreachable.
local function fetch_remote_config()
    local url = ff_url .. '/api/addon-config'
    local scheme, host, port, path = url:match('^(https?)://([^:/]+):?(%d*)(/?.*)$')
    if not scheme then return end
    if path == '' then path = '/' end

    local body
    if scheme == 'http' then
        -- Non-blocking path: dev server (localhost) can take seconds to compile
        -- the route on first hit, but the game stays responsive throughout.
        body = async_http_get(host, tonumber(port) or 80, path, 8)
    else
        -- https: TLS is hard to do non-blocking; this path targets the fast,
        -- reachable production server so a brief deferred call is acceptable.
        local resp = {}
        local ok, code = https.request{
            url = url, sink = ltn12.sink.table(resp), method = 'GET',
            headers = { ['Accept'] = 'application/json' },
        }
        if ok and code == 200 then body = table.concat(resp) end
    end
    if not body then return end

    local cfg = json.decode(body)
    if not cfg then return end

    if cfg.warpEnter then
        for k, v in pairs(cfg.warpEnter) do
            WARP_ENTER[tonumber(k)] = v
        end
    end
    if cfg.bossExitArea then
        for k, v in pairs(cfg.bossExitArea) do
            BOSS_EXIT_AREA[k] = v
        end
    end
    if cfg.warpExitIds then
        for k in pairs(WARP_EXIT_IDS) do WARP_EXIT_IDS[k] = nil end
        for _, id in ipairs(cfg.warpExitIds) do WARP_EXIT_IDS[id] = true end
    end
    if cfg.bossExitMenuId  then boss_exit_menu_id   = cfg.bossExitMenuId  end
    if cfg.aminonExitMenuId then aminon_exit_menu_id = cfg.aminonExitMenuId end
    if cfg.aminonExitArea   then aminon_exit_area    = cfg.aminonExitArea   end
end

-- Deferred so this network fetch never blocks the synchronous addon load
-- (a slow/unreachable server would otherwise freeze the game during load).
coroutine.schedule(fetch_remote_config, 0)
local area_timers = {
    ['Ground Floor']=0,
    ['Sector E']=0, ['Sector F']=0, ['Sector G']=0, ['Sector H']=0,
    ['Boss A']=0, ['Boss B']=0, ['Boss C']=0, ['Boss D']=0,
    ['Boss E']=0, ['Boss F']=0, ['Boss G']=0, ['Boss H']=0,
    ['Aminon']=0,
}
local current_area = nil
local area_enter_time = nil
local sortie_start_time = nil  -- wall-clock time when Sortie began (for journey log timestamps)

-- All Sortie streaming-log tables collected on one table so the disk
-- log_writer (which reads source[field_name] every tick) sees them via
-- `sortie_enc[name]` instead of `_G[name]`. Before this refactor a stray
-- `local` keyword on any of the 19 tables would silently drop that log
-- from saved Sortie reports 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｩ鬮ｯ譎｢・ｽ・ｷ郢晢ｽｻ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｴ鬯ｮ・ｮ隲幢ｽｶ繝ｻ・ｽ繝ｻ・｣驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｯ髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｷ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｮ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｮ鬮ｫ・ｲ陝ｷ・｢繝ｻ・ｽ繝ｻ・ｶ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｣鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻbit us 2026-06-07. Pattern mirrors
-- tracker.lua's `enc` table.
sortie_enc = {
    action_log = {},
    position_log = {},
    party_hp_log = {},
    party_tp_log = {},
    party_mp_log = {},
    buff_log = {},
    skillchain_log = {},
    battle_msg_raw = {},
    battle_msg_raw_state = ff_raw_battle_state_new(),
    job_extended_log = {},
    job_extended_state = ff_job_extended_state_new(),
    effect_log = {},
    effect_state = ff_effect_state_new(),
    party_buff_state = ff_party_buff_state_new(),
    boss_hp_log = {},
    kill_log = {},
    item_use_log = {},
    pet_log = {},
    pet_ids = {},
    pet_names_seen = {},
    zone_log = {},
    death_log = {},
    chest_log = {},
    mini_nm_log = {},
    drop_log = {},
    absorb_tp_log = {},
    party_position_log = {},
}
sortie_points_start = nil       -- ff_points_totals() snapshot at sortie start; delta becomes saved points
local dead_members = {}
local seen_alive = {}
-- Packet-based mob death tracking (incoming 0x000E with hpp鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｲ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・､鬯ｮ・ｫ繝ｻ・ｲ髫ｶ蜴・ｽｽ・ｸ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｺ鬯ｮ・ｫ繝ｻ・ｨ郢晢ｽｻ繝ｻ・ｳ鬮ｯ・ｷ・つ髫ｴ莨夲ｽｽ・ｦ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｹ鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｮ・ｯ隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｫ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｮ繝ｻ・ｮ髫ｲ蟷｢・ｽ・ｶ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｣鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ transition):
local last_hpp = {}            -- [entity_id] = most recent hpp seen (0-100)
local dead_ids = {}            -- [entity_id] = true; suppresses duplicate kill logs
-- Self position sampling (outgoing 0x0015 fires every frame; we downsample to 1 Hz):
local last_position_sample = 0 -- os.time() of last write into sortie_enc.position_log
-- HP time-series for tracked bosses (sourced from 0x000E with mask bit 2 set):
local last_boss_hpp = {}       -- [boss_name] = most recently logged hpp (dedup state)
-- HP time-series for party members (polled from windower.ffxi.get_party() at 1 Hz):
local last_party_hpp = {}      -- [player_name] = most recently logged hpp
local last_party_hp_sample = 0 -- os.time() of last poll
-- TP time-series for party members (polled at the same 1 Hz as HP). Stored
-- separately so a future schema change to one log doesn't drag the other.
local last_party_tp = {}       -- [player_name] = most recently logged tp
local last_party_mp = {}       -- [player_name] = most recently logged mpp
local last_party_pos = {}      -- [player_name] = { x, y, z } for movement dedup
local party_max_hp = {}        -- [player_name] = derived max HP (hp/hpp) for damage-taken severity
local party_max_mp = {}        -- [player_name] = derived max MP (mp/mpp) for caster context

local function pos_moved_sortie(store, key, x, y, z)
    local p = store[key]
    if not p then store[key] = { x = x, y = y, z = z }; return true end
    local dx, dy, dz = x - p.x, y - p.y, z - p.z
    if dx * dx + dy * dy + dz * dz >= 1.0 then
        p.x, p.y, p.z = x, y, z
        return true
    end
    return false
end
local BUFF_GAIN_MSG = { [82]=true,[127]=true,[141]=true,[160]=true,[164]=true,[166]=true,
    [186]=true,[194]=true,[203]=true,[205]=true,[230]=true,[236]=true,[237]=true,[242]=true,
    [243]=true,[266]=true,[267]=true,[268]=true,[269]=true,[270]=true,[271]=true,[272]=true,
    [277]=true,[278]=true,[279]=true,[280]=true,[319]=true,[320]=true,[374]=true,[375]=true,
    [412]=true,[519]=true,[520]=true,[521]=true,[591]=true,[645]=true,[754]=true,[755]=true }
local BUFF_WEAR_MSG = { [64]=true,[83]=true,[123]=true,[159]=true,[168]=true,[204]=true,
    [206]=true,[321]=true,[322]=true,[341]=true,[342]=true,[343]=true,[344]=true,[350]=true,
    [351]=true,[378]=true,[453]=true,[531]=true,[647]=true,[806]=true }
local DEATH_MSG = FF_DEATH_MSG

local AMINON_NAMES = { ['Aminon']=true, ['鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｯ髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｷ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｧ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｩ鬮ｯ譎｢・ｽ・ｷ郢晢ｽｻ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｴ鬯ｮ・ｮ隲幢ｽｶ繝ｻ・ｽ繝ｻ・｣驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｯ髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｷ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｮ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｮ繝ｻ・ｯ髮矩醍袖繝ｻ・ｱ陞｢・ｹ郢晢ｽｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｱ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｺ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｮ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｮ・ｯ陷茨ｽｷ繝ｻ・ｽ繝ｻ・ｹ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｺ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢郢晢ｽｻ繝ｻ・ｧ鬮ｫ・ｰ郢晢ｽｻ遶乗ｧｭ繝ｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・･鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｮ鬮ｫ・ｲ陝ｷ・｢繝ｻ・ｽ繝ｻ・ｶ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｣鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｣鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｰ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｯ髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｷ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｮ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｮ鬮ｫ・ｲ陝ｷ・｢繝ｻ・ｽ繝ｻ・ｶ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｣鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｳ']=true }
local function is_aminon_name(nm)
    return nm and AMINON_NAMES[nm] or false
end
local last_party_buffs = {}    -- [player_name] = { [buff_id]=true } from previous get_party() sample
local last_self_buff_set = {}  -- [buff_id]=true from previous 0x063 sample
local recent_buff_events = {}  -- dedup key -> os.time(); prevents 0x028+0x029 double-logging

local SKILLCHAIN_NAMES_EN = {
    [288]='Light',[289]='Darkness',[290]='Gravitation',[291]='Fragmentation',
    [292]='Distortion',[293]='Fusion',[294]='Compression',[295]='Liquefaction',
    [296]='Induration',[297]='Reverberation',[298]='Transfixion',[299]='Scission',
    [300]='Detonation',[301]='Impaction',
    [385]='Light',[386]='Darkness',[387]='Gravitation',[388]='Fragmentation',
    [389]='Distortion',[390]='Fusion',[391]='Compression',[392]='Liquefaction',
    [393]='Induration',[394]='Reverberation',[395]='Transfixion',[396]='Scission',
    [397]='Detonation',[398]='Impaction',
    [767]='Radiance',[768]='Umbra',[769]='Radiance',[770]='Umbra',
}

local SKILLCHAIN_NAMES_JA_EN = {}
SKILLCHAIN_NAMES = setmetatable({}, {
    __index = function(_, k)
        local en = SKILLCHAIN_NAMES_EN[k]
        if not en then return nil end
        if FF_CLIENT_LANG == 'ja' then return SKILLCHAIN_NAMES_JA_EN[en] or en end
        return en
    end,
})

-- Pet snapshots, silently gathered at 1 Hz (no UI yet). {elapsed, owner, pet, hpp, tp, target}
last_pet_state = {}            -- [owner] = 'petname:hpp' to dedup unchanged samples
-- Battle messages of interest beyond buffs: spell resists and interrupted casts.

-- Resolve Absorb-TP spell ID from resources (used for action packet detection)
local ABSORB_TP_ID = nil
for id, sp in pairs(res.spells) do
    if sp.en == 'Absorb-TP' or sp.english == 'Absorb-TP' then
        ABSORB_TP_ID = id
        break
    end
end

local AREA_DEDUPE_WINDOW = 2  -- seconds within which a repeat enter_area() to the
                              -- same area is treated as a SuperWarp double-fire.

-- Start (or switch to) a named area timer, banking elapsed time from the previous area
local function enter_area(area)
    local now = os.time()
    if current_area == area and area_enter_time
       and os.difftime(now, area_enter_time) <= AREA_DEDUPE_WINDOW then
        return
    end
    if current_area and area_enter_time then
        area_timers[current_area] = area_timers[current_area] + os.difftime(now, area_enter_time)
    end
    current_area = area
    area_enter_time = now
    if sortie_start_time then
        table.insert(sortie_enc.zone_log, {area = area, elapsed = math.floor(os.difftime(now, sortie_start_time)), galli = gallimaufry_total})
    end
end

-- Return to ground floor (called on warp-out from any sector/boss room)
local function exit_to_ground_floor()
    local now = os.time()
    if current_area == 'Ground Floor' and area_enter_time
       and os.difftime(now, area_enter_time) <= AREA_DEDUPE_WINDOW then
        return
    end
    if current_area and area_enter_time then
        area_timers[current_area] = area_timers[current_area] + os.difftime(now, area_enter_time)
    end
    current_area = 'Ground Floor'
    area_enter_time = now
    if sortie_start_time then
        table.insert(sortie_enc.zone_log, {area = 'Ground Floor', elapsed = math.floor(os.difftime(now, sortie_start_time)), galli = gallimaufry_total})
    end
end

-- Format numbers with commas
function comma_value(n)
    local left, num, right = tostring(n):match('^([^%d]*%d)(%d*)(.-)$')
    return left .. (num:reverse():gsub('(%d%d%d)', '%1,'):reverse()) .. right
end

-- Timestamp for file naming
function get_timestamp()
    return os.date('%Y-%m-%d_%H-%M-%S')
end

function reconcile_party_name(id, name)
    if not (id and id > 0 and name and name ~= '') then return end
    local prev_name = party_id_to_name[id]
    if prev_name and prev_name ~= name then
        if party_jobs[prev_name] and not party_jobs[name] then
            party_jobs[name] = party_jobs[prev_name]
        end
        party_jobs[prev_name] = nil
        -- Record the alias (legacy name_alias path). Repoint any existing
        -- aliases that pointed at prev_name so chained renames still resolve.
        name_alias[prev_name] = name
        for k, v in pairs(name_alias) do
            if v == prev_name then name_alias[k] = name end
        end
        -- sortie_enc.action_log: player field by id, target.mob by target id
        for _, entry in ipairs(sortie_enc.action_log) do
            if entry.playerId == id then entry.player = name end
            if entry.targets then
                for _, t in ipairs(entry.targets) do
                    if t.id == id then t.mob = name end
                end
            end
        end
        -- sortie_enc.absorb_tp_log: player field by id
        for _, entry in ipairs(sortie_enc.absorb_tp_log) do
            if entry.playerId == id then entry.player = name end
        end
        -- sortie_enc.death_log: matched by old name string (chat-derived, no id captured)
        for _, entry in ipairs(sortie_enc.death_log) do
            if entry.player == prev_name then entry.player = name end
        end
        -- sortie_enc.buff_log: party_poll entries are keyed by NAME only (no id), so the
        -- pre-mod name leaks here until rewritten. Also fix targetId/appliedBy.
        for _, entry in ipairs(sortie_enc.buff_log) do
            if entry.target == prev_name or entry.targetId == id then entry.target = name end
            if entry.appliedBy == prev_name then entry.appliedBy = name end
        end
        -- sortie_enc.skillchain_log: closer + target mob by name
        for _, entry in ipairs(sortie_enc.skillchain_log) do
            if entry.closer == prev_name then entry.closer = name end
            if entry.mob == prev_name then entry.mob = name end
        end
        for _, entry in ipairs(sortie_enc.item_use_log) do
            if entry.player == prev_name then entry.player = name end
        end
        for _, entry in ipairs(sortie_enc.party_hp_log) do
            if entry.player == prev_name then entry.player = name end
        end
        for _, entry in ipairs(sortie_enc.party_tp_log) do
            if entry.player == prev_name then entry.player = name end
        end
        for _, entry in ipairs(sortie_enc.pet_log) do
            if entry.owner == prev_name then entry.owner = name end
        end
        -- Dedup state maps keyed by name: re-key prev_name -> name so the next
        -- poll diff doesn't re-emit the whole buff/HP set under the old name.
        local function rekey(tbl)
            if tbl[prev_name] ~= nil and tbl[name] == nil then
                tbl[name] = tbl[prev_name]
            end
            tbl[prev_name] = nil
        end
        rekey(last_party_buffs)
        rekey(last_party_hpp)
        rekey(last_pet_state)
        rekey(dead_members)
        rekey(seen_alive)
        rekey(party_max_hp)
        rekey(party_max_mp)
        -- Silent reconcile: prev_name is the raw pre-customizer name and must
        -- never be echoed to chat (could be on a stream/screenshot), and the
        -- diagnostic itself was noise.
    end
    party_id_to_name[id] = name
end

function self_name()
    local p = windower.ffxi.get_player()
    if not p then return nil end
    if p.id and party_id_to_name[p.id] then return party_id_to_name[p.id] end
    if p.id and p.id > 0 then return resolve_member_name(p.id, p.name) end
    return p.name
end

function update_job_info(id, name, main_job_id, main_lvl, sub_job_id, sub_lvl)
    local job_mapping = {
        [1] = 'WAR', [2] = 'MNK', [3] = 'WHM', [4] = 'BLM', [5] = 'RDM', [6] = 'THF',
        [7] = 'PLD', [8] = 'DRK', [9] = 'BST', [10] = 'BRD', [11] = 'RNG', [12] = 'SAM',
        [13] = 'NIN', [14] = 'DRG', [15] = 'SMN', [16] = 'BLU', [17] = 'COR', [18] = 'PUP',
        [19] = 'DNC', [20] = 'SCH', [21] = 'GEO', [22] = 'RUN'
    }

    reconcile_party_name(id, name)

    local has_job = main_job_id ~= nil and main_job_id ~= 0
    if has_job then
        party_jobs[name] = {
            main = job_mapping[main_job_id] or tostring(main_job_id),
            main_lvl = main_lvl or 0,
            sub = job_mapping[sub_job_id] or tostring(sub_job_id),
            sub_lvl = sub_lvl or 0,
        }
    elseif party_jobs[name] == nil then
        party_jobs[name] = { main = '?', main_lvl = 0, sub = '?', sub_lvl = 0 }
    end
end


-- Strip Windower color escape codes (0x1E + color byte, 0x1F suffix)
function strip_escape_codes(s)
    return s:gsub('\030.', ''):gsub('\031', '')
end

-- Force-encode a Lua table as a JSON array (handles empty tables correctly)
function arr(t)
    return setmetatable(t or {}, {__jsontype = 'array'})
end




local function save_run_snapshot(parse_filename)
    local snapshot = {
        parse_filename    = parse_filename,
        sortie_start_time = sortie_start_time,
        fight_start_time  = fight_start_time,
        fight_end_time    = fight_end_time,
        starting_galli    = starting_galli,
        ending_galli      = ending_galli,
        galli_total       = galli_total,
        hm                = hm,
        meso_count        = meso_count,
        wild_card_roll    = wild_card_roll,
        aminon_rolls      = aminon_rolls,
        aurum_chest       = aurum_chest,
        naaks             = naaks,
        flans_killed      = flans_killed,
        aminon_defeated   = aminon_defeated,
        additional_note   = additional_note,
        drops             = drops,
        sector_objectives = sector_objectives,
        area_timers       = area_timers,
        party_jobs        = party_jobs,
        party_id_to_name  = party_id_to_name,
        name_alias        = name_alias,
        boss_fight_start  = boss_fight_start,
        boss_fight_end    = boss_fight_end,
        boss_min_hp       = boss_min_hp,
        defeated_mini_nms = defeated_mini_nms,
        naakual_kills     = naakual_kills,
        zone_log          = sortie_enc.zone_log,
        death_log         = sortie_enc.death_log,
        chest_log         = sortie_enc.chest_log,
        mini_nm_log       = sortie_enc.mini_nm_log,
        drop_log          = sortie_enc.drop_log,
        action_log        = sortie_enc.action_log,
        combat_stats      = combat_stats,
        absorb_tp_log     = sortie_enc.absorb_tp_log,
        kill_log          = sortie_enc.kill_log,
        last_hpp          = last_hpp,
        dead_ids          = dead_ids,
        item_use_log      = sortie_enc.item_use_log,
        position_log      = sortie_enc.position_log,
        boss_hp_log       = sortie_enc.boss_hp_log,
        last_boss_hpp     = last_boss_hpp,
        party_hp_log      = sortie_enc.party_hp_log,
        last_party_hpp    = last_party_hpp,
        party_tp_log      = sortie_enc.party_tp_log,
        last_party_tp     = last_party_tp,
        buff_log          = sortie_enc.buff_log,
        last_party_buffs  = last_party_buffs,
        last_self_buff_set= last_self_buff_set,
        skillchain_log    = sortie_enc.skillchain_log,
        pet_log           = sortie_enc.pet_log,
        last_pet_state    = last_pet_state,
    }
    local target = windower.addon_path .. 'data/last_snapshot.json'
    _write_table_streamed(target, snapshot)
end

local function trim_log(log, max)
    if not log or #log <= max then return 0 end
    local dropped = #log - max
    for i = 1, max do log[i] = log[i + dropped] end
    for i = #log, max + 1, -1 do log[i] = nil end
    return dropped
end

local LOG_CAPS = {
    position_log  = 7200,   -- 1 Hz polling 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｮ・ｯ隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｫ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｮ繝ｻ・ｮ髫ｲ蟷｢・ｽ・ｶ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｣鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｮ・ｯ隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｫ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｮ繝ｻ・ｮ髫ｲ蟷｢・ｽ・ｶ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｣鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｮ・ｯ隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｫ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｮ繝ｻ・ｮ髫ｲ蟷｢・ｽ・ｶ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｣鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ2 h
    action_log    = 10000,  -- ~3000-5000 typical for a busy run
    buff_log      = 5000,
    boss_hp_log   = 5000,
    party_hp_log  = 5000,
    party_tp_log  = 5000,
    kill_log      = 2000,
    drop_log      = 1000,
    item_use_log  = 1000,
    zone_log      =  500,
    death_log     =  200,
    chest_log     =  200,
    mini_nm_log   =  200,
    absorb_tp_log =  500,
    skillchain_log = 2000,
    pet_log       = 3000,
}

local function apply_log_caps()
    local trimmed = {}
    local function maybe_trim(name, log)
        local dropped = trim_log(log, LOG_CAPS[name])
        if dropped > 0 then trimmed[#trimmed + 1] = ('%s -%d'):format(name, dropped) end
    end
    maybe_trim('position_log',  sortie_enc.position_log)
    maybe_trim('action_log',    sortie_enc.action_log)
    maybe_trim('buff_log',      sortie_enc.buff_log)
    maybe_trim('boss_hp_log',   sortie_enc.boss_hp_log)
    maybe_trim('party_hp_log',  sortie_enc.party_hp_log)
    maybe_trim('party_tp_log',  sortie_enc.party_tp_log)
    maybe_trim('kill_log',      sortie_enc.kill_log)
    maybe_trim('drop_log',      sortie_enc.drop_log)
    maybe_trim('item_use_log',  sortie_enc.item_use_log)
    maybe_trim('zone_log',      sortie_enc.zone_log)
    maybe_trim('death_log',     sortie_enc.death_log)
    maybe_trim('chest_log',     sortie_enc.chest_log)
    maybe_trim('mini_nm_log',   sortie_enc.mini_nm_log)
    maybe_trim('absorb_tp_log', sortie_enc.absorb_tp_log)
    maybe_trim('skillchain_log', sortie_enc.skillchain_log)
    maybe_trim('pet_log',       sortie_enc.pet_log)
    -- Pure time-series (path + HP/TP curves): decimate to keep the save light on
    -- long runs without losing combat fidelity (deaths live in sortie_enc.death_log).
    downsample_log(sortie_enc.position_log, 1800)
    downsample_log(sortie_enc.party_hp_log, 1800)
    downsample_log(sortie_enc.party_tp_log, 1800)
    if #trimmed > 0 then
        gn_chat('Capped oversized logs before save (oldest entries dropped): ' .. table.concat(trimmed, ', '))
    end
end

local function generate_report()
    local _perf_t0 = os.clock()
    local _perf = {}
    local function _mark(name)
        _perf[#_perf + 1] = string.format('%s=%dms', name, math.floor((os.clock() - _perf_t0) * 1000))
        _perf_t0 = os.clock()
    end

    apply_log_caps()
    _mark('caps')

    local _run_id = 'iv_' .. tostring(os.time())

    save_run_snapshot(_run_id)
    _mark('snap1')

    currency.request_update()
    coroutine.sleep(2)
    _mark('wait2s')
    ending_galli = currency.display_values() or starting_galli
    galli_total  = ending_galli - starting_galli
    save_run_snapshot(_run_id)
    _mark('snap2')

    local _combat_data = next(combat_stats) and combat_stats or nil

    local ok, err = pcall(function()

    -- Defeated bosses (tracked from incoming text kill messages, not Scoreboard)
    local defeated_list = arr{}
    for _, boss in ipairs(sector_bosses) do
        if boss_fight_end[boss] then table.insert(defeated_list, boss) end
    end
    if fight_end_time then table.insert(defeated_list, 'Aminon') end

    -- Bonus objectives: build list of killed NM names (for bonusObjectives field)
    local mini_nm_list = arr{}
    for nname, _ in pairs(BONUS_NM) do
        if defeated_mini_nms[nname] then table.insert(mini_nm_list, nname) end
    end

    -- Treasure chests: classification is resolved server-side via sortie_enc.chest_log + chestIds mapping.
    local chests, caskets, coffers = arr{}, arr{}, arr{}

    -- Party: use party_jobs (populated live from packets during the run).
    -- get_party() is unreliable at report time since zone-out clears party data.
    local name_to_id = {}
    for id, nm in pairs(party_id_to_name) do name_to_id[nm] = id end
    local party_array = arr{}
    for name, info in pairs(party_jobs) do
        table.insert(party_array, {
            id        = name_to_id[name] or json.null,
            name      = name,
            mainJob   = info.main,
            mainLevel = info.main_lvl,
            subJob    = info.sub,
            subLevel  = info.sub_lvl,
        })
    end

    -- Aminon: collect if the fight started, even if Aminon wasn't killed (wipe/partial)
    local aminon_obj = json.null
    if fight_start_time then
        local aminon_damage = parse_damage_from_export(_combat_data, 'Aminon')
        if aminon_damage then
            local aminon_stats = parse_stats_from_export(_combat_data, 'Aminon')
            local duration = 0
            if fight_end_time then
                duration = os.difftime(fight_end_time, fight_start_time)
            else
                -- Partial fight: use banked Aminon area time as best estimate
                duration = math.floor(area_timers['Aminon'] or 0)
            end
            local rolls_obj = json.null
            local m = aminon_rolls["Miser's"]    or {value=0, lucky=false}
            local t = aminon_rolls["Tactician's"] or {value=0, lucky=false}
            if m.value > 0 or t.value > 0 or wild_card_roll > 0 then
                rolls_obj = {
                    misers         = m.value,
                    misersLucky    = m.lucky,
                    tactician      = t.value,
                    tacticianLucky = t.lucky,
                    wildCard       = wild_card_roll,
                }
            end
            local absorb_total = 0
            for _, e in ipairs(sortie_enc.absorb_tp_log) do absorb_total = absorb_total + (e.amount or 0) end
            aminon_obj = {
                mode                 = hm and 'hardmode' or 'normal',
                killed               = fight_end_time ~= nil,
                minHpPct             = boss_min_hp['Aminon'],
                rolls                = rolls_obj,
                fightDurationSeconds = duration,
                fightStartElapsed    = sortie_start_time and math.floor(os.difftime(fight_start_time, sortie_start_time)) or json.null,
                damageReport         = aminon_damage,
                wsAverages           = aminon_stats.wsAverages,
                wsAccuracy           = aminon_stats.wsAccuracy,
                accuracy             = aminon_stats.accuracy,
                critRate             = aminon_stats.critRate,
                meleeAverage         = aminon_stats.meleeAverage,
                meleeCritAverage     = aminon_stats.meleeCritAverage,
                absorbTpLog          = #sortie_enc.absorb_tp_log > 0 and sortie_enc.absorb_tp_log or json.null,
                absorbTpTotal        = absorb_total > 0 and absorb_total or json.null,
            }
            if hm then aminon_obj.mesoCount = meso_count end
        end
    end

    -- Sector boss reports: collect for any boss we engaged, even if not killed
    local boss_area_key = {
        Ghatjot='Boss A', Leshonn='Boss B', Skomora='Boss C', Degei='Boss D',
        Dhartok='Boss E', Gartell='Boss F', Triboulex='Boss G', Aita='Boss H',
    }
    local boss_reports_obj = {}
    for _, boss_name in ipairs(sector_bosses) do
        if boss_fight_start[boss_name] then
            local damage_entries = parse_damage_from_export(_combat_data, boss_name)
            local boss_stats = parse_stats_from_export(_combat_data, boss_name) or {}
            local killed = boss_fight_end[boss_name] ~= nil
            local duration = 0
            if killed then
                duration = os.difftime(boss_fight_end[boss_name], boss_fight_start[boss_name])
            else
                duration = math.floor(area_timers[boss_area_key[boss_name]] or 0)
            end
            boss_reports_obj[boss_name] = {
                killed               = killed,
                fightDurationSeconds = duration,
                fightStartElapsed    = sortie_start_time and math.floor(os.difftime(boss_fight_start[boss_name], sortie_start_time)) or json.null,
                minHpPct             = boss_min_hp[boss_name],
                damageReport         = damage_entries or json.null,
                wsAverages           = boss_stats.wsAverages or json.null,
                wsAccuracy           = boss_stats.wsAccuracy or json.null,
                accuracy             = boss_stats.accuracy or json.null,
                critRate             = boss_stats.critRate or json.null,
                meleeAverage         = boss_stats.meleeAverage or json.null,
                meleeCritAverage     = boss_stats.meleeCritAverage or json.null,
            }
        end
    end
    local boss_reports_final = next(boss_reports_obj) ~= nil and boss_reports_obj or json.null

    -- Snapshot area timers (adds any still-running area without mutating the live timers)
    local area_snap = {}
    for k, v in pairs(area_timers) do area_snap[k] = v end
    if current_area and area_enter_time then
        area_snap[current_area] = (area_snap[current_area] or 0) + os.difftime(os.time(), area_enter_time)
    end
    local area_times_obj = {
        groundFloor = math.floor(area_snap['Ground Floor'] or 0),
        sectorE     = math.floor(area_snap['Sector E']     or 0),
        sectorF     = math.floor(area_snap['Sector F']     or 0),
        sectorG     = math.floor(area_snap['Sector G']     or 0),
        sectorH     = math.floor(area_snap['Sector H']     or 0),
        bossA       = math.floor(area_snap['Boss A']       or 0),
        bossB       = math.floor(area_snap['Boss B']       or 0),
        bossC       = math.floor(area_snap['Boss C']       or 0),
        bossD       = math.floor(area_snap['Boss D']       or 0),
        bossE       = math.floor(area_snap['Boss E']       or 0),
        bossF       = math.floor(area_snap['Boss F']       or 0),
        bossG       = math.floor(area_snap['Boss G']       or 0),
        bossH       = math.floor(area_snap['Boss H']       or 0),
        aminon      = math.floor(area_snap['Aminon']       or 0),
    }

    -- Build per-sector Naakual kill data
    local naakual_report = {}
    for _, sector in ipairs({'E', 'F', 'G', 'H'}) do
        local kills = naakual_kills[sector] or {}
        local any_kills = false
        local first_t, last_t = nil, nil
        local kill_list = {}
        for _, nname in ipairs(NAAKUAL_NAMES) do
            local t = kills[nname]
            kill_list[nname] = t or json.null
            if t then
                any_kills = true
                if not first_t or t < first_t then first_t = t end
                if not last_t  or t > last_t  then last_t  = t end
            end
        end
        if any_kills then
            local completed = true
            for _, nname in ipairs(NAAKUAL_NAMES) do
                if not kills[nname] then completed = false; break end
            end
            naakual_report[sector] = {
                kills     = kill_list,
                completed = completed,
                firstKill = first_t or json.null,
                lastKill  = last_t  or json.null,
                duration  = (completed and first_t and last_t) and (last_t - first_t) or json.null,
            }
        end
    end
    local naakual_report_final = next(naakual_report) ~= nil and naakual_report or json.null

    -- Self gear sets (precast/midcast) + state sets (Engaged/Idle/鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｩ鬮ｯ譎｢・ｽ・ｷ郢晢ｽｻ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｴ鬯ｮ・ｮ隲幢ｽｶ繝ｻ・ｽ繝ｻ・｣驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｮ・ｯ隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｫ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｮ繝ｻ・ｮ髫ｲ蟷｢・ｽ・ｶ郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｣鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｩ鬮ｯ譎｢・ｽ・ｷ郢晢ｽｻ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｴ鬯ｮ・ｮ隲幢ｽｶ繝ｻ・ｽ繝ｻ・｣驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｦ) from the
    -- shared capture engine (non-destructive read).
    local sortie_gear_log, sortie_state_sets
    if ff_gear_result then sortie_gear_log, sortie_state_sets = ff_gear_result() end

    if sortie_start_time and current_area then
        local final_elapsed = math.floor(os.difftime(os.time(), sortie_start_time))
        local last = sortie_enc.zone_log[#sortie_enc.zone_log]
        local already = last and last.area == current_area
            and last.elapsed == final_elapsed
            and last.galli == gallimaufry_total
        if not already then
            table.insert(sortie_enc.zone_log, {
                area    = current_area,
                elapsed = final_elapsed,
                galli   = gallimaufry_total,
            })
        end
    end

    -- Assemble report
    local report = {
        version    = 1,
        runDate    = os.date('%Y-%m-%dT%H:%M:%S'),
        zoneName   = (in_sortie_zone_name and in_sortie_zone_name ~= '') and in_sortie_zone_name or 'Outer Ra\'Kaznar',
        gallimaufry  = (gallimaufry_total and gallimaufry_total > 0)
            and gallimaufry_total
            or ((galli_total and galli_total > 0 and galli_total < 200000) and galli_total or 0),
        oldCasePlus1 = drops.oldCasePlus1,
        drops = drops,
        defeatedBosses = defeated_list,
        bonusObjectives = {
            aurumChest      = aurum_chest,
            naakualSets     = naaks,
            basementMiniNms = mini_nm_list,
            flans           = flans_killed,
        },
        treasureContainers = {
            chests  = chests,
            caskets = caskets,
            coffers = coffers,
        },
        sectorObjectives = {
            A = sector_objectives.A, B = sector_objectives.B,
            C = sector_objectives.C, D = sector_objectives.D,
            E = sector_objectives.E, F = sector_objectives.F,
            G = sector_objectives.G, H = sector_objectives.H,
        },
        party       = party_array,
        playerIds   = next(name_to_id) and name_to_id or json.null,
        aminon      = aminon_obj,
        bossReports = boss_reports_final,
        areaTimes   = area_times_obj,
        zoneLog        = #sortie_enc.zone_log > 0 and sortie_enc.zone_log or json.null,
        deathLog       = #sortie_enc.death_log > 0 and sortie_enc.death_log or json.null,
        chestLog       = #sortie_enc.chest_log > 0 and sortie_enc.chest_log or json.null,
        naakualKills   = naakual_report_final,
        miniNmLog      = #sortie_enc.mini_nm_log > 0 and sortie_enc.mini_nm_log or json.null,
        dropLog        = #sortie_enc.drop_log > 0 and sortie_enc.drop_log or json.null,
        notes          = additional_note,
        sortieStartTime = sortie_start_time,
        -- combatStats intentionally dropped from the saved report 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｩ鬮ｯ譎｢・ｽ・ｷ郢晢ｽｻ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｴ鬯ｮ・ｮ隲幢ｽｶ繝ｻ・ｽ繝ｻ・｣驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｯ髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｷ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｮ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｮ鬮ｫ・ｲ陝ｷ・｢繝ｻ・ｽ繝ｻ・ｶ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｣鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻthe desktop
        -- derives it from actionLog via combatStatsFromActionLog, which is what
        -- the existing fallback in EncounterView.tsx / RunTabs.tsx already does
        -- when the field is empty. The live overlay reads ff_live_combat_stats
        -- directly, so dropping the saved copy doesn't affect anything.
        combatStats    = json.null,
        actionLog      = #sortie_enc.action_log > 0 and sortie_enc.action_log or json.null,
        killLog        = #sortie_enc.kill_log > 0 and sortie_enc.kill_log or json.null,
        itemUseLog     = #sortie_enc.item_use_log > 0 and sortie_enc.item_use_log or json.null,
        positionLog    = #sortie_enc.position_log > 0 and sortie_enc.position_log or json.null,
        bossHpLog      = #sortie_enc.boss_hp_log  > 0 and sortie_enc.boss_hp_log  or json.null,
        partyHpLog     = #sortie_enc.party_hp_log > 0 and sortie_enc.party_hp_log or json.null,
        partyTpLog     = #sortie_enc.party_tp_log > 0 and sortie_enc.party_tp_log or json.null,
        partyMaxHp     = (next(party_max_hp) and party_max_hp) or json.null,
        partyMaxMp     = (next(party_max_mp) and party_max_mp) or json.null,
        points         = (function()
            if not ff_points_totals or not sortie_points_start then return json.null end
            local now = ff_points_totals()
            local d = {
                xp = math.max(0, (now.xp or 0) - (sortie_points_start.xp or 0)),
                cp = math.max(0, (now.cp or 0) - (sortie_points_start.cp or 0)),
                ep = math.max(0, (now.ep or 0) - (sortie_points_start.ep or 0)),
                lp = math.max(0, (now.lp or 0) - (sortie_points_start.lp or 0)),
            }
            if d.xp + d.cp + d.ep + d.lp == 0 then return json.null end
            return d
        end)(),
        buffLog        = #sortie_enc.buff_log     > 0 and sortie_enc.buff_log     or json.null,
        skillchainLog  = #sortie_enc.skillchain_log > 0 and sortie_enc.skillchain_log or json.null,
        petLog         = #sortie_enc.pet_log      > 0 and sortie_enc.pet_log      or json.null,
        gearLog        = sortie_gear_log or json.null,
        stateSets      = sortie_state_sets or json.null,
        localCharacter = (ff_local_char and ff_local_char()) or json.null,
    }

    _mark('build')
    if sortie_log_writer then
        -- Fast path: partials were being written incrementally throughout the
        -- run. finalize() just writes the small scalar fields and stream-copies
        -- the partials into a single .json. Save-time hitch is ~100-500 ms even
        -- on huge encounters.
        local writer = sortie_log_writer
        sortie_log_writer = nil
        local _tag   = ff_char_filetag and ff_char_filetag() or 'unknown'
        local _fname = string.format('sortie_%d__%s.json', sortie_start_time, _tag)
        -- All Sortie reports land in data/Sortie/, regardless of which Sortie
        -- instance ([U2]/[U3]) the run happened in. Unifies the history so
        -- desktop UI sees one Sortie folder instead of two zone-named ones.
        local _zone_dir = windower.addon_path .. 'data/Sortie'
        gn_ensure_dir(_zone_dir)
        local _path  = _zone_dir .. '/' .. _fname
        coroutine.schedule(function()
            local ok, telemetry = writer.finalize(report, _path)
            if ok then
                gn_chat(('Report saved to: data/Sortie/%s'):format(_fname))
            else
                gn_chat_warn(('Save failed: %s -- falling back to coop'):format(tostring(telemetry)))
                save_report_file(report)
            end
        end, 0)
    else
        coroutine.schedule(function() save_report_file(report) end, 0)
    end
    _mark('sched')

    end)  -- end pcall
    if not ok then
        gn_chat_warn('Report error: ' .. tostring(err))
        gn_chat('Run data saved to data/last_snapshot.json')
    end

end


-- All event handlers --

-- Track zone entry/exit to know when we're inside Sortie (Ra'Kaznar)
windower.register_event('zone change', function(new_zone_id, old_zone_id)
    local zone_info = res.zones[new_zone_id]
    local zone_name = zone_info and zone_info.en or ''

    if zone_name:lower():find("ra'kaznar") and (zone_name:find("%[U2%]") or zone_name:find("%[U3%]")) then
        in_sortie = true
        in_sortie_zone_name = zone_name  -- captured for the save path so the file lands in the right zone folder
        party_jobs = {}
        party_id_to_name = {}
        name_alias = {}
        combat_stats = {}
        ff_live_combat_stats = combat_stats
        sortie_start_time = os.time()
        ff_live_combat_start = sortie_start_time
        sortie_points_start = ff_points_totals and ff_points_totals() or nil
        if ff_gear_start then sortie_gear_token = ff_gear_start(sortie_start_time) end
        if ff_live_state_open then
            ff_live_state_open({
                start_os       = sortie_start_time,
                source         = 'sortie',
                zone_name      = zone_name,
                get_deaths     = function() return #sortie_enc.death_log end,
                get_party_jobs = function() return party_jobs end,
            })
        end
        sortie_enc.zone_log = {}
        sortie_enc.death_log = {}
        dead_members = {}
        seen_alive = {}
        container_log = {}
        sortie_enc.chest_log = {}
        opened_chests = {}
        last_hpp = {}
        dead_ids = {}
        sortie_enc.kill_log = {}
        sortie_enc.item_use_log = {}
        sortie_enc.position_log = {}
        last_position_sample = 0
        sortie_enc.boss_hp_log = {}
        last_boss_hpp = {}
        sortie_enc.party_hp_log = {}
        last_party_hpp = {}
        last_party_hp_sample = 0
        sortie_enc.party_tp_log = {}
        last_party_tp = {}
        sortie_enc.party_mp_log = {}
        last_party_mp = {}
        sortie_enc.party_position_log = {}
        last_party_pos = {}
        party_max_hp = {}
        party_max_mp = {}
        sortie_enc.buff_log = {}
        last_party_buffs = {}
        last_self_buff_set = {}
        recent_buff_events = {}
        sortie_enc.skillchain_log = {}
        sortie_enc.pet_log = {}
        last_pet_state = {}
        sortie_enc.battle_msg_raw = {}
        sortie_enc.battle_msg_raw_state = ff_raw_battle_state_new()
        sortie_enc.job_extended_log = {}
        sortie_enc.job_extended_state = ff_job_extended_state_new()
        sortie_enc.effect_log = {}
        sortie_enc.effect_state = ff_effect_state_new()
        sortie_enc.party_buff_state = ff_party_buff_state_new()
        enter_area('Ground Floor')
        -- Disk-streamed log writer: background coroutine appends new entries
        -- from these globals to .partial files every 5 s. If a previous Sortie
        -- ended without a save (user reloaded mid-run / re-entered), discard
        -- the stale writer so its partials get cleaned up first.
        if sortie_log_writer then sortie_log_writer.discard() end
        do
            local _tag = ff_char_filetag and ff_char_filetag() or 'unknown'
            gn_ensure_dir(GN_PARTIALS_DIR)
            local _prefix = GN_PARTIALS_DIR .. '/sortie_' .. sortie_start_time .. '__' .. _tag
            sortie_log_writer = log_writer.open(_prefix, sortie_enc, GN_LOG_MAP)
        end
        gn_chat('Entered Sortie - party tracking active.')
        -- Capture starting balance now (after currency packet has had time to arrive)
        currency.request_update()
        coroutine.schedule(function()
            starting_galli = currency.display_values() or 0
            gallimaufry_total = 0
        end, 2)
        -- Retry at 2s, 5s, and 15s 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｩ鬮ｯ譎｢・ｽ・ｷ郢晢ｽｻ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｴ鬯ｮ・ｮ隲幢ｽｶ繝ｻ・ｽ繝ｻ・｣驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｯ髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｷ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｮ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｮ鬮ｫ・ｲ陝ｷ・｢繝ｻ・ｽ繝ｻ・ｶ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｣鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻgame memory often isn't fully populated for
        -- other party members until several seconds after zone-in.
        coroutine.schedule(refresh_party_from_memory, 2)
        coroutine.schedule(refresh_party_from_memory, 5)
        coroutine.schedule(refresh_party_from_memory, 15)
    else
        -- Finalize any running Sortie area timer
        if current_area and area_enter_time then
            area_timers[current_area] = area_timers[current_area] + os.difftime(os.time(), area_enter_time)
            area_enter_time = nil
            current_area = nil
        end
        if in_sortie and auto_report then
            gn_chat('Left Sortie - auto-generating report...')
            coroutine.schedule(generate_report, 0.5)
        end
        if in_sortie and ff_gear_stop then ff_gear_stop(sortie_gear_token) end
        in_sortie = false
        ff_live_combat_stats = nil
        ff_live_combat_start = nil
        if ff_live_state_close then ff_live_state_close() end
    end
end)

function resolve_member_name(id, fallback_name)
    if id and id > 0 then
        local mob = windower.ffxi.get_mob_by_id(id)
        if mob and mob.name and mob.name ~= '' then
            return mob.name
        end
    end
    return fallback_name
end

-- Populate party_jobs from game memory (covers all 3 alliance parties).
-- Called at zone-in with a small delay so party data has loaded.
function refresh_party_from_memory()
    local pt = windower.ffxi.get_party()
    if not pt then return end
    for _, v in pairs(pt) do
        if type(v) == 'table' and v.name and v.name ~= '' and v.id and v.id > 0 then
            local name = resolve_member_name(v.id, v.name)
            update_job_info(v.id, name, v.main_job, v.main_job_level, v.sub_job, v.sub_job_level)
        end
    end
end

function record_death(pname, source)
    if not in_sortie or not sortie_start_time then return end
    local entry = ff_log_party_death(sortie_enc.death_log, dead_members, sortie_start_time,
                                     pname, current_area or 'Unknown', source)
    if entry then
        -- Name-free on purpose: a pre-reconcile death can carry the raw name.
        gn_chat(('Death recorded in %s.'):format(current_area or 'Unknown'))
    end
end

function is_run_member(name)
    if not name or name == '' then return false end
    local me = windower.ffxi.get_player()
    if me and me.name == name then return true end
    local pt = windower.ffxi.get_party()
    if pt then
        for _, v in pairs(pt) do
            if type(v) == 'table' and v.name and v.name ~= '' then
                if v.name == name then return true end
                if v.id and v.id > 0 and resolve_member_name(v.id, v.name) == name then return true end
            end
        end
    end
    -- Fall back to any name we've ever tracked this run (covers members who
    -- have since dropped off get_party(), e.g. zoned into a boss room).
    if party_jobs[name] or party_id_to_name then
        if party_jobs[name] then return true end
        for _, pn in pairs(party_id_to_name) do
            if pn == name then return true end
        end
    end
    return false
end

local function log_buff_event(kind, target_name, target_id, buff_id, source, applied_by, applied_by_spell, duration)
    ff_log_buff_event(sortie_enc.buff_log, recent_buff_events, sortie_start_time, {
        kind             = kind,
        target_name      = target_name,
        target_id        = target_id,
        buff_id          = buff_id,
        source           = source,
        applied_by       = applied_by,
        applied_by_spell = applied_by_spell,
        duration         = duration,
    })
end

function handle_entity_death(entity_id)
    local entry = ff_log_entity_death(sortie_enc.kill_log, dead_ids, sortie_start_time, entity_id,
                                      current_area or 'Unknown',
                                      function(n) return party_jobs[n] ~= nil end)
    if not entry then return end
    local name = entry.name
    local elapsed = entry.elapsed

    -- Aminon
    if is_aminon_name(name) then
        if not aminon_defeated then
            aminon_defeated = true
            fight_end_time = fight_end_time or os.time()
            local dur = fight_start_time and os.difftime(fight_end_time, fight_start_time) or 0
            gn_chat(('Aminon defeated (packet, %ds).'):format(dur))
            table.insert(sortie_enc.mini_nm_log, {name='Aminon', sector='Aminon', elapsed=elapsed, type='aminon'})
        end
    -- Sector boss
    elseif boss_sector_map[name] then
        if not boss_fight_end[name] then
            boss_fight_end[name] = os.time()
            local dur = boss_fight_start[name] and os.difftime(boss_fight_end[name], boss_fight_start[name]) or nil
            gn_chat(('%s defeated (packet%s).'):format(name, dur and (', '..dur..'s') or ''))
            table.insert(sortie_enc.mini_nm_log, {name=name, sector=boss_sector_map[name], elapsed=elapsed, type='boss'})
        end
    end

    -- Bonus NM (orthogonal to boss 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｩ鬮ｯ譎｢・ｽ・ｷ郢晢ｽｻ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｴ鬯ｮ・ｮ隲幢ｽｶ繝ｻ・ｽ繝ｻ・｣驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｯ髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｷ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｮ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｮ鬮ｫ・ｲ陝ｷ・｢繝ｻ・ｽ繝ｻ・ｶ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｣鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻfires independently)
    if BONUS_NM[name] and not defeated_mini_nms[name] then
        defeated_mini_nms[name] = true
        gn_chat(('%s defeated! (Sector %s bonus, packet)'):format(name, BONUS_NM[name]))
        table.insert(sortie_enc.mini_nm_log, {name=name, sector=BONUS_NM[name], elapsed=elapsed})
    end

    -- Naakual 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｩ鬮ｯ譎｢・ｽ・ｷ郢晢ｽｻ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｴ鬯ｮ・ｮ隲幢ｽｶ繝ｻ・ｽ繝ｻ・｣驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｯ髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｷ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｮ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｮ鬮ｫ・ｲ陝ｷ・｢繝ｻ・ｽ繝ｻ・ｶ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｣鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻonly count when the kill occurred in the matching basement sector
    if current_area then
        local sector = current_area:match('^Sector ([EFGH])$')
        if sector then
            for _, nname in ipairs(NAAKUAL_NAMES) do
                if nname == name and not naakual_kills[sector][nname] then
                    naakual_kills[sector][nname] = elapsed
                    local count = 0
                    for _, n in ipairs(NAAKUAL_NAMES) do
                        if naakual_kills[sector][n] then count = count + 1 end
                    end
                    gn_chat(('%s defeated in Sector %s! (%d/6, packet)'):format(nname, sector, count))
                    if count == 6 then
                        gn_chat(('Sector %s Naakual objective complete!'):format(sector))
                    end
                    break
                end
            end
        end
    end
end

windower.register_event('incoming chunk', function(id, data, modified, injected, blocked)

    if in_sortie and id == 0x000E then
        local eid = data:unpack('I', 0x04 + 1)
        if eid and eid ~= 0 and not dead_ids[eid] then
            local mask = data:unpack('C', 0x0A + 1) or 0
            if bit.band(mask, 0x04) ~= 0 then
                local hpp = data:unpack('C', 0x1E + 1)
                if hpp ~= nil then
                    local prev = last_hpp[eid]
                    last_hpp[eid] = hpp
                    if hpp == 0 and (prev == nil or prev > 0) then
                        handle_entity_death(eid)
                    end
                    if sortie_start_time then
                        local mob = windower.ffxi.get_mob_by_id(eid)
                        if mob and mob.name and track_target_set[mob.name] then
                            if last_boss_hpp[mob.name] ~= hpp then
                                last_boss_hpp[mob.name] = hpp
                                ff_log_boss_hp_sample(sortie_enc.boss_hp_log,
                                    math.floor(os.difftime(os.time(), sortie_start_time)),
                                    mob.name, hpp, eid)
                            end
                        end
                        if ff_live_state_hp_update then
                            local lname = (mob and mob.name) or nil
                            if lname then
                                local kill_entry = ff_live_state_hp_update(eid, lname, hpp)
                                if kill_entry and ff_ipc_send_kill then
                                    ff_ipc_send_kill(kill_entry)
                                end
                            end
                        end
                    end
                end
            end
        end
    end

    if in_sortie and sortie_start_time and id == 0x044 then
        ff_log_job_extended(sortie_enc.job_extended_log, sortie_enc.job_extended_state, sortie_start_time, data)
    end

    if in_sortie and sortie_start_time and id == 0x030 then
        ff_log_effect(sortie_enc.effect_log, sortie_enc.effect_state, sortie_start_time, data)
    end

    if in_sortie and sortie_start_time and id == 0x076 then
        ff_log_party_buffs(sortie_enc.buff_log, recent_buff_events, sortie_enc.party_buff_state, sortie_start_time, data, party_jobs, party_id_to_name)
    end

    if in_sortie and sortie_start_time and id == 0x029 then
        ff_log_battle_message_raw(sortie_enc.battle_msg_raw, sortie_enc.battle_msg_raw_state, sortie_start_time, data)
        local msg = data:unpack('H', 0x18 + 1)
        local tgt_id = data:unpack('I', 0x08 + 1)
        if msg and tgt_id and tgt_id ~= 0 and DEATH_MSG[msg] then
            local mob = windower.ffxi.get_mob_by_id(tgt_id)
            local nm = mob and mob.name
            if nm and is_run_member(nm) then
                -- 'packet' = deterministic 0x029 KO signal. dead_members latch
                -- is set inside ff_log_party_death; no need to touch it here.
                record_death(nm, 'packet')
            end
        end
        if msg and BUFF_WEAR_MSG[msg] then
            local buff_id = data:unpack('I', 0x0C + 1)
            if tgt_id and tgt_id ~= 0 then
                local mob = windower.ffxi.get_mob_by_id(tgt_id)
                if mob and mob.name and (track_target_set[mob.name] or party_jobs[mob.name]) then
                    log_buff_event('wear', mob.name, tgt_id, buff_id, '0x029')
                end
            end
        end
    end

    -- 0x063 = local player char-update (carries the self buff list with end timestamps).
    -- Diff against last_self_buff_set; emit gain/wear events for the local player.
    if in_sortie and sortie_start_time and id == 0x063 then
        local player = windower.ffxi.get_player()
        if player then
            local pname = self_name() or player.name
            local durations = ff_parse_buff_list_packet(data)
            local current = {}
            for bid in pairs(durations) do current[bid] = true end
            for bid in pairs(current) do
                if not last_self_buff_set[bid] then
                    log_buff_event('gain', pname, player.id, bid, '0x063', nil, nil, durations[bid])
                end
            end
            for bid in pairs(last_self_buff_set) do
                if not current[bid] then
                    log_buff_event('wear', pname, player.id, bid, '0x063')
                end
            end
            last_self_buff_set = current
        end
    end

    -- 0xDD = party member update
    if in_sortie and id == 0xDD then
        local packet = packets.parse('incoming', data)
        if packet then
            local playerId = packet['ID']
            if playerId and playerId > 0 then
                local name = resolve_member_name(playerId, packet['Name'])
                if name and name ~= '' then
                    update_job_info(playerId, name, packet['Main job'], packet['Main job level'],
                                packet['Sub job'], packet['Sub job level'])

                    local zone_no = packet['Zone']
                    local same_zone = (zone_no == nil) or (zone_no == 0)
                    if same_zone and sortie_start_time then
                        local hp, hpp = packet['HP'], packet['HP%']
                        if hp and hp > 0 and hpp and hpp > 0 then
                            if hpp == 100 then
                                party_max_hp[name] = hp
                            elseif not party_max_hp[name] then
                                party_max_hp[name] = math.floor(hp / hpp * 100 + 0.5)
                            end
                        end
                        local mp, mpp = packet['MP'], packet['MP%']
                        if mp and mp > 0 and mpp and mpp > 0 then
                            if mpp == 100 then
                                party_max_mp[name] = mp
                            elseif not party_max_mp[name] then
                                party_max_mp[name] = math.floor(mp / mpp * 100 + 0.5)
                            end
                        end
                        local elapsed = math.floor(os.difftime(os.time(), sortie_start_time))
                        local tp = packet['TP']
                        if tp ~= nil and last_party_tp[name] ~= tp then
                            last_party_tp[name] = tp
                            ff_log_party_tp_sample(sortie_enc.party_tp_log, elapsed, name, tp, playerId)
                        end
                        if hpp ~= nil and last_party_hpp[name] ~= hpp then
                            last_party_hpp[name] = hpp
                            ff_log_party_hp_sample(sortie_enc.party_hp_log, elapsed, name, hpp, playerId)
                        end
                    end
                end
            end
        end
    end

    if id == 0x05B then
        local packet = packets.parse('incoming', data)
        if packet then
            local pid = packet['ID']
            -- Only log IDs in the plausible treasure container range
            if pid >= 21000100 and pid <= 21000270 then
                -- Dedup by raw NPC ID (IDs are unique per chest)
                local already_found = false
                for _, existing in ipairs(opened_chests) do
                    if existing == pid then
                        already_found = true
                        break
                    end
                end
                if not already_found then
                    table.insert(opened_chests, pid)
                    if sortie_start_time then
                        local elapsed = math.floor(os.difftime(os.time(), sortie_start_time))
                        table.insert(sortie_enc.chest_log, {
                            npcId   = pid,
                            area    = current_area or 'Unknown',
                            elapsed = elapsed,
                        })
                    end
                    gn_chat(('Chest opened: ID #%d'):format(pid))
                end
            end
        end
    end

end)


windower.register_event('outgoing chunk', function(id, data, modified, injected, blocked)
    if id == 0x05C then
        local p = packets.parse('outgoing', data)
        if not p then return end
        local menu_id = p['Menu ID']
        if not menu_id then return end

        if in_sortie then
            if menu_id == 1022 then
                local u1 = p['_unknown1']
                hm = (u1 == 2)
                enter_area('Aminon')
                gn_chat(('Entered Aminon%s.'):format(hm and ' (Hard Mode)' or ''))
            elseif WARP_ENTER[menu_id] then
                enter_area(WARP_ENTER[menu_id])
                gn_chat(('Entered %s.'):format(WARP_ENTER[menu_id]))
            elseif menu_id == boss_exit_menu_id then
                local return_area = (current_area and BOSS_EXIT_AREA[current_area]) or 'Ground Floor'
                enter_area(return_area)
                gn_chat(('Left boss room, returned to %s.'):format(return_area))
            elseif menu_id == aminon_exit_menu_id then
                enter_area(aminon_exit_area)
                gn_chat(('Left Aminon, returned to %s.'):format(aminon_exit_area))
            elseif WARP_EXIT_IDS[menu_id] then
                exit_to_ground_floor()
                gn_chat('Returned to Ground Floor.')
            end
        end
        return
    end

    if id == 0x05B and in_sortie then
        local p = packets.parse('outgoing', data)
        if not p then return end
        if p['Menu ID'] == 1022 then
            local opt = p['Option Index']
            if opt == 1 or opt == 2 then
                local new_hm = (opt == 2)
                if new_hm ~= hm then
                    hm = new_hm
                    gn_chat(('Aminon mode reconciled to %s (0x05B Option=%d).')
                        :format(hm and 'Hard' or 'Normal', opt))
                end
            end
        end
        return
    end

    if in_sortie and sortie_start_time and id == 0x0015 then
        local now = os.time()
        if (now - last_position_sample) >= 1 and not (ff_movement_disabled and ff_movement_disabled()) then
            last_position_sample = now
            local x = data:unpack('f', 0x04 + 1)
            local z = data:unpack('f', 0x08 + 1)
            local y = data:unpack('f', 0x0C + 1)
            local dir = data:unpack('b', 0x14 + 1)  -- int8
            if x and y and z then
                ff_log_self_position(sortie_enc.position_log,
                    math.floor(os.difftime(now, sortie_start_time)),
                    x, y, z, dir, current_area)
            end
        end

        if (now - last_party_hp_sample) >= 1 then
            last_party_hp_sample = now
            local pt = windower.ffxi.get_party()
            if pt then
                local elapsed = math.floor(os.difftime(now, sortie_start_time))
                local my_zone = (windower.ffxi.get_info() or {}).zone
                for _, v in pairs(pt) do
                    if type(v) == 'table' and v.name and v.name ~= '' then
                        local mname = resolve_member_name(v.id, v.name)
                        if v.id and v.id > 0 then reconcile_party_name(v.id, mname) end
                        if v.hp and v.hp > 0 and v.hpp and v.hpp > 0 then
                            if v.hpp == 100 then
                                party_max_hp[mname] = v.hp
                            elseif not party_max_hp[mname] then
                                party_max_hp[mname] = math.floor(v.hp / v.hpp * 100 + 0.5)
                            end
                        end
                        if v.mp and v.mp > 0 and v.mpp and v.mpp > 0 then
                            if v.mpp == 100 then
                                party_max_mp[mname] = v.mp
                            elseif not party_max_mp[mname] then
                                party_max_mp[mname] = math.floor(v.mp / v.mpp * 100 + 0.5)
                            end
                        end
                        local same_zone = (v.zone == nil) or (my_zone and v.zone == my_zone)
                        if v.hpp ~= nil and same_zone and last_party_hpp[mname] ~= v.hpp then
                            last_party_hpp[mname] = v.hpp
                            ff_log_party_hp_sample(sortie_enc.party_hp_log, elapsed, mname, v.hpp, v.id)
                        end
                        if same_zone and v.tp ~= nil and last_party_tp[mname] ~= v.tp then
                            last_party_tp[mname] = v.tp
                            ff_log_party_tp_sample(sortie_enc.party_tp_log, elapsed, mname, v.tp, v.id)
                        end
                        if same_zone and v.mpp ~= nil and last_party_mp[mname] ~= v.mpp then
                            last_party_mp[mname] = v.mpp
                            ff_log_party_mp_sample(sortie_enc.party_mp_log, elapsed, mname, v.mpp, v.id)
                        end
                        if v.hpp ~= nil then
                            if v.hpp > 0 then
                                seen_alive[mname] = true
                                dead_members[mname] = nil
                            end
                        end
                        if same_zone and not (ff_movement_disabled and ff_movement_disabled()) then
                            local mob = v.mob
                            if mob and mob.x and mob.y and mob.z and pos_moved_sortie(last_party_pos, mname, mob.x, mob.y, mob.z) then
                                ff_log_party_position(sortie_enc.party_position_log, elapsed, mname, mob.x, mob.y, mob.z, mob.heading)
                            end
                        end
                        -- Buff diff: get_party() member tables expose `.buffs` as an array.
                        if v.buffs then
                            local current = {}
                            for _, bid in ipairs(v.buffs) do
                                if bid and bid ~= 255 and bid ~= 0 then current[bid] = true end
                            end
                            local prev = last_party_buffs[mname] or {}
                            for bid in pairs(current) do
                                if not prev[bid] then
                                    log_buff_event('gain', mname, v.id, bid, 'party_poll')
                                end
                            end
                            for bid in pairs(prev) do
                                if not current[bid] then
                                    log_buff_event('wear', mname, v.id, bid, 'party_poll')
                                end
                            end
                            last_party_buffs[mname] = current
                        end
                    end
                end
            end

            -- Pet snapshot (silent gather). Local player's pet only 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｩ鬮ｯ譎｢・ｽ・ｷ郢晢ｽｻ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｴ鬯ｮ・ｮ隲幢ｽｶ繝ｻ・ｽ繝ｻ・｣驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｯ髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｷ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｮ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｮ鬮ｫ・ｲ陝ｷ・｢繝ｻ・ｽ繝ｻ・ｶ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｣鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻalliance
            -- pets aren't reliably reachable without scanning the full mob array.
            local owner = self_name()
            local pet = windower.ffxi.get_mob_by_target and windower.ffxi.get_mob_by_target('pet')
            if owner and pet then
                ff_log_pet_snapshot(sortie_enc.pet_log, sortie_start_time, last_pet_state, owner, pet)
            end
        end
    end
end)

-- Roll data for Aminon fight tracking (built once at load, not on every action event)
local rollInfoTemp = {
    -- For Aminon we only care about Tact/Miser
    ['Miser\'s']     = {30,50,70,90,200,110,20,130,150,170,250,'0',' Save TP',5,7,15,{nil,0}},
    ['Tactician\'s'] = {10,10,10,10,30,10,10,0,20,20,40,'-10',' Regain',5,8,2,{nil,0},{5,11100,26930,26931,10}},
}
local rollInfo = {}
for key, val in pairs(rollInfoTemp) do
    local ability = res.job_abilities:with('english', key .. ' Roll')
    if ability then
        rollInfo[ability.id] = {key, unpack(val)}
    end
end

local wildcard_table = {
    [435] = 1, [436] = 2, [437] = 3, [438] = 4, [440] = 5, [439] = 6,
}

-- Find roll values during Aminon battle
-- Referenced and used code from the 'rolltracker' add-on. Thanks!
windower.register_event('action', function(act)
    -- Multibox role=local: host box owns combat; skip the heavy per-action parsing
    -- (gear/position/self-buffs are captured by separate handlers).
    if ff_is_local() then return end
    if in_sortie and sortie_start_time and ff_combat_accumulate then
        ff_combat_accumulate(combat_stats, act)
    end
    if boss_starts_needed > 0 then
        for _, tgt in ipairs(act.targets or {}) do
            if tgt and tgt.id then
                local mob = windower.ffxi.get_mob_by_id(tgt.id)
                if mob then
                    for _, bname in ipairs(sector_bosses) do
                        if mob.name == bname and not boss_fight_start[bname] then
                            boss_fight_start[bname] = os.time()
                            boss_starts_needed = boss_starts_needed - 1
                            gn_chat(('%s encounter started.'):format(bname))
                            break
                        end
                    end
                end
            end
        end
    end

    -- Track minimum HP% seen for each tracked boss (sector bosses + Aminon).
    -- Fires on every action targeting a tracked mob so we capture the fight low.
    for _, tgt in ipairs(act.targets or {}) do
        if tgt and tgt.id then
            local mob = windower.ffxi.get_mob_by_id(tgt.id)
            if mob and track_target_set[mob.name] then
                local hp = mob.hpp
                if hp ~= nil then
                    if not boss_min_hp[mob.name] or hp < boss_min_hp[mob.name] then
                        boss_min_hp[mob.name] = hp
                    end
                end
            end
        end
    end

    if in_sortie and sortie_start_time and act.targets then
        for _, tgt in ipairs(act.targets) do
            if tgt and tgt.id and tgt.actions and tgt.actions[1] then
                local a = tgt.actions[1]
                local msg = a.message
                local kind = (BUFF_GAIN_MSG[msg] and 'gain') or (BUFF_WEAR_MSG[msg] and 'wear') or nil
                if kind then
                    local tgt_mob = windower.ffxi.get_mob_by_id(tgt.id)
                    if tgt_mob and tgt_mob.name then
                        local nm = tgt_mob.name
                        local is_npc_enemy = tgt_mob.is_npc and not party_jobs[nm]
                        if party_jobs[nm] or is_npc_enemy or track_target_set[nm] then
                            local applied_by, applied_by_spell
                            if kind == 'gain' and act.actor_id then
                                applied_by = party_id_to_name[act.actor_id]
                                    or resolve_member_name(act.actor_id, nil)
                                local src_actor = windower.ffxi.get_mob_by_id(act.actor_id)
                                applied_by_spell = ff_resolve_action_name_type(act, src_actor and src_actor.name, party_jobs)
                            end
                            local buff_id = a.param
                            if act.category == 14 or act.category == 15 then
                                local ja = res.job_abilities and res.job_abilities[act.param]
                                if ja and ja.status and ja.status ~= 0 then
                                    buff_id = ja.status
                                end
                            end
                            log_buff_event(kind, nm, tgt.id, buff_id, '0x028', applied_by, applied_by_spell)
                        end
                    end
                end
            end
        end
    end

    -- Item use tracking 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｩ鬮ｯ譎｢・ｽ・ｷ郢晢ｽｻ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｴ鬯ｮ・ｮ隲幢ｽｶ繝ｻ・ｽ繝ｻ・｣驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｯ髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｷ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｮ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｮ鬮ｫ・ｲ陝ｷ・｢繝ｻ・ｽ繝ｻ・ｶ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｣鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻshared helper handles the cat==5 gate, party filter,
    -- and item-name resolution. Sortie just supplies the area context.
    if in_sortie then
        ff_log_item_use_event(sortie_enc.item_use_log, sortie_start_time, act, {
            party_jobs = party_jobs,
            area       = current_area or 'Unknown',
        })
    end

    local cat1_aminon = false
    if act.category == 1 then
        if act.targets then
            for _, t in ipairs(act.targets) do
                if t and t.id then
                    local m = windower.ffxi.get_mob_by_id(t.id)
                    if m and is_aminon_name(m.name) then cat1_aminon = true break end
                end
            end
        end
        if not cat1_aminon then
            local am = windower.ffxi.get_mob_by_id(act.actor_id)
            if am and is_aminon_name(am.name) then cat1_aminon = true end
        end
    end
    local log_autos = cat1_aminon or sortie_capture ~= 'lean'
    if in_sortie and sortie_start_time and (act.category == 3 or act.category == 4 or act.category == 6 or act.category == 11 or act.category == 13 or act.category == 14 or act.category == 15 or (act.category == 1 and log_autos)) then
        ff_log_action_event(sortie_enc.action_log, sortie_enc.skillchain_log, sortie_start_time, act, {
            party_jobs       = party_jobs,
            party_id_to_name = party_id_to_name,
            capture_swings   = sortie_capture == 'full',
            is_actor_boss    = function(name) return track_target_set[name] ~= nil end,
            on_actor_reconcile = function(actor_id, new_name)
                reconcile_party_name(actor_id, new_name)
            end,
            pet_ids          = sortie_enc.pet_ids,
            pet_names        = sortie_enc.pet_names_seen,
        })
    end

    if in_sortie then
        ff_log_action_start(sortie_enc.action_log, sortie_start_time, act, { party_jobs = party_jobs })
        ff_log_action_interrupt(sortie_enc.action_log, sortie_start_time, act, { party_jobs = party_jobs })
    end

    -- Track rolls unconditionally so pre-buffed rolls (cast before fight_start_time
    -- is detected) are captured. The reset at run start clears stale data.
    do
        local target = act.targets and act.targets[1]
        local action  = target and target.actions and target.actions[1]

        -- For wild card parsing (only meaningful during the fight itself)
        if fight_start_time and act.category == 6 and act.param == 96 and action then
            wild_card_roll = wildcard_table[action.message] or 0
        end

        -- For tact/miser parsing 鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｯ鬮ｯ・ｷ髣鯉ｽｨ繝ｻ・ｽ繝ｻ・ｷ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｹ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｩ鬮ｯ譎｢・ｽ・ｷ郢晢ｽｻ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｮ繝ｻ・ｫ郢晢ｽｻ繝ｻ・ｴ鬯ｮ・ｮ隲幢ｽｶ繝ｻ・ｽ繝ｻ・｣驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｶ鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｯ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｯ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｩ鬯ｯ・ｮ繝ｻ・ｯ髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｷ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｯ郢晢ｽｻ繝ｻ・ｮ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｫ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｴ鬯ｯ・ｯ繝ｻ・ｮ郢晢ｽｻ繝ｻ・ｮ鬮ｫ・ｲ陝ｷ・｢繝ｻ・ｽ繝ｻ・ｶ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｣鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・｢鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬯ｯ・ｯ繝ｻ・ｩ髯晢ｽｷ繝ｻ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬯ｮ・ｫ繝ｻ・ｴ鬮ｮ諛ｶ・ｽ・｣郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・｢鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｯ・ｩ陝ｷ・｢繝ｻ・ｽ繝ｻ・｢鬮ｫ・ｴ髮懶ｽ｣繝ｻ・ｽ繝ｻ・｢驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｽ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻ鬯ｩ蟷｢・ｽ・｢髫ｴ雜｣・ｽ・｢郢晢ｽｻ繝ｻ・ｽ郢晢ｽｻ繝ｻ・ｻ鬩幢ｽ｢隴趣ｽ｢繝ｻ・ｽ繝ｻ・ｻ驛｢譎｢・ｽ・ｻ郢晢ｽｻ繝ｻ・ｻtrack always so pre-rolls are not missed
        if act.category == 6 and table.containskey(rollInfo, act.param) and action then
            local rollID  = act.param
            local rollNum = action.param
            for roll_name, data in pairs(aminon_rolls) do
                if rollInfo[rollID][1] == roll_name then
                    if rollNum == rollInfo[rollID][15] or rollNum == 11 then
                        aminon_rolls[roll_name].lucky = true
                    end
                    aminon_rolls[roll_name].value = rollNum
                end
            end
        end
    end

    -- Track all magic actions against Aminon during the fight.
    -- Logs raw spell ID, actor, and all action params/messages to identify Absorb-TP fields.
    if fight_start_time and act.category == 4 then
        local actor_mob = windower.ffxi.get_mob_by_id(act.actor_id)
        if actor_mob then
            for _, tgt in ipairs(act.targets or {}) do
                if tgt and tgt.id then
                    local tgt_mob = windower.ffxi.get_mob_by_id(tgt.id)
                    if tgt_mob and is_aminon_name(tgt_mob.name) then
                        local elapsed = sortie_start_time and math.floor(os.difftime(os.time(), sortie_start_time)) or 0
                        local spell = res.spells[act.param]
                        local spell_name = ff_loc_name(spell, tostring(act.param))
                        local actions_raw = {}
                        for i, a in ipairs(tgt.actions or {}) do
                            actions_raw[i] = {msg=a.message, param=a.param}
                        end
                        local entry = {elapsed=elapsed, playerId=act.actor_id, player=actor_mob.name, spell=spell_name, spellId=act.param, actions=actions_raw}
                        table.insert(sortie_enc.absorb_tp_log, entry)
                        -- Print to chat so it's visible live during the fight
                        local a1 = tgt.actions and tgt.actions[1]
                        gn_chat(('%s -> Aminon: spell=%s(%d) msg=%s param=%s'):format(
                            actor_mob.name, spell_name, act.param,
                            tostring(a1 and a1.message), tostring(a1 and a1.param)))
                    end
                end
            end
        end
    end

end)



-- Event to detect incoming text for tracking.
windower.register_event('incoming text', function(original, modified, mode)
    if not in_sortie then return end

    -- Strip escape codes once for all pattern matching in this handler
    local orig_lower = strip_escape_codes(original):lower()

    -- Look for the start of battle
    if not fight_start_time then
        if orig_lower:find("flash") and orig_lower:find("aminon") then
            fight_start_time = os.time()
            gn_chat(('Encounter start detected at %s'):format(os.date('%X', fight_start_time)))
        end
    end

    -- Look for end of the battle
    if not aminon_defeated and (orig_lower:match('defeats? aminon') or orig_lower:match('aminon.+defeated')) then
        aminon_defeated = true
        fight_end_time = os.time()
        local duration = os.difftime(fight_end_time, fight_start_time or fight_end_time)
        gn_chat(('Encounter ended after %d seconds.'):format(duration))
        local elapsed = sortie_start_time and math.floor(os.difftime(os.time(), sortie_start_time)) or 0
        table.insert(sortie_enc.mini_nm_log, {name='Aminon', sector='Aminon', elapsed=elapsed, type='aminon'})
    end

    -- Track sector boss fight end times (start is detected via action packets)
    for _, boss_name in ipairs(sector_bosses) do
        local bln = boss_name:lower()
        if not boss_fight_end[boss_name] and (orig_lower:match('defeats? ' .. bln) or orig_lower:match(bln .. '.+defeated') or orig_lower:match(bln .. '.+falls to the ground')) then
            boss_fight_end[boss_name] = os.time()
            local elapsed = sortie_start_time and math.floor(os.difftime(os.time(), sortie_start_time)) or 0
            table.insert(sortie_enc.mini_nm_log, {name=boss_name, sector=boss_sector_map[boss_name], elapsed=elapsed, type='boss'})
            local dur = boss_fight_start[boss_name] and os.difftime(boss_fight_end[boss_name], boss_fight_start[boss_name]) or nil
            if dur then
                gn_chat(('%s defeated after %d sec.'):format(boss_name, dur))
            end
        end
    end

    -- Track bonus NM objective kills (one per sector A-H)
    for nname, sector in pairs(BONUS_NM) do
        local nln = nname:lower()
        if not defeated_mini_nms[nname] and (orig_lower:match('defeats? ' .. nln) or orig_lower:match(nln .. '.+defeated')) then
            defeated_mini_nms[nname] = true
            local elapsed = sortie_start_time and math.floor(os.difftime(os.time(), sortie_start_time)) or 0
            table.insert(sortie_enc.mini_nm_log, { name=nname, sector=sector, elapsed=elapsed })
            gn_chat(('%s defeated! (Sector %s bonus objective)'):format(nname, sector))
        end
    end

    -- Track Naakual kills per sector
    if in_sortie and sortie_start_time and current_area then
        local sector = current_area:match('^Sector ([EFGH])$')
        if sector then
            for _, nname in ipairs(NAAKUAL_NAMES) do
                local nln = nname:lower()
                if not naakual_kills[sector][nname] and (orig_lower:match('defeats.+' .. nln) or orig_lower:match(nln .. '.+defeated')) then
                    local elapsed = math.floor(os.difftime(os.time(), sortie_start_time))
                    naakual_kills[sector][nname] = elapsed
                    local count = 0
                    for _, n in ipairs(NAAKUAL_NAMES) do
                        if naakual_kills[sector][n] then count = count + 1 end
                    end
                    gn_chat(('%s defeated in Sector %s! (%d/6)'):format(nname, sector, count))
                    if count == 6 then
                        gn_chat(('Sector %s Naakual objective complete!'):format(sector))
                    end
                end
            end
        end
    end

    -- Track flan kills
    if not flans_killed and (orig_lower:match('defeats.+flan') or orig_lower:match('flan.+defeated')) then
        flans_killed = true
        gn_chat('Flan defeated!')
    end

    if in_sortie and sortie_start_time then
        local function log_death(pname) record_death(pname, 'chat') end

        local function own_name()
            return self_name()
        end

        -- Normalize: drop escape codes, CR/LF, and any leading whitespace so
        -- the ^ anchors below line up with the actual name.
        local stripped = strip_escape_codes(original):gsub('[\r\n]', ''):gsub('^%s+', '')


        -- "<name> was defeated by ...", "<name> was defeated."
        local victim = stripped:match('^(.-) was defeated by ')
                     or stripped:match('^(.-) was defeated%.')
        if victim and victim ~= '' and is_run_member(victim) then
            log_death(victim)
        elseif stripped:match('^You were defeated') then
            local n = own_name(); if n then log_death(n) end
        end

        -- "<name> falls to the ground."
        local fallen = stripped:match('^(.-) falls to the ground')
        if fallen and fallen ~= '' and is_run_member(fallen) then
            log_death(fallen)
        elseif stripped:match('^You fall to the ground') then
            local n = own_name(); if n then log_death(n) end
        end
    end

    if mode == 121 or mode == 123 or mode == 10 or mode == 12 or mode == 13 or mode == 14 or mode == 5 then
       
        -- Clean control codes from the incoming line
        local cleaned_line = original:gsub('\30[%d%a]', ''):gsub('\31', ''):gsub('[\r\n]', '')
        
        -- Match player name and gallimaufry amount with according to the in-game text pattern
        local player_name, amount = cleaned_line:match("([%a%-']+)%s+received%s+(%d+)%s+gallimaufry%s+for%s+a%s+total%s+of%s+%d+%.*")

        if player_name and amount then
            gallimaufry_total = gallimaufry_total + tonumber(amount)
            gn_chat(('Received %s gallimaufry. Total: %s'):format(
                comma_value(amount),
                comma_value(gallimaufry_total)
            ))

            -- Check if opened Aurum chest
            if tonumber(amount) == 1000 then
                aurum_chest = true
                gn_chat('Aurum chest opened!')
            end 

            -- Check if defeated Naakuals
            if tonumber(amount) == 1500 then
                naaks = naaks + 1
                gn_chat('Naakual chest opened!')
            end

            -- Boss kill detection via galli reward (reliable alternative to kill text)
            -- 2000 = ground floor boss (A-D), 10000 = basement boss (E-H), 30000 = Aminon
            local galli_amt = tonumber(amount)
            local GROUND_BOSS = {Ghatjot=true, Leshonn=true, Skomora=true, Degei=true}
            local BASEMENT_BOSS = {Dhartok=true, Gartell=true, Triboulex=true, Aita=true}

            if galli_amt == 2000 or galli_amt == 10000 then
                local candidates = galli_amt == 2000 and GROUND_BOSS or BASEMENT_BOSS
                for _, bname in ipairs(sector_bosses) do
                    if candidates[bname] and boss_fight_start[bname] and not boss_fight_end[bname] then
                        boss_fight_end[bname] = os.time()
                        local elapsed = sortie_start_time and math.floor(os.difftime(os.time(), sortie_start_time)) or 0
                        table.insert(sortie_enc.mini_nm_log, {name=bname, sector=boss_sector_map[bname], elapsed=elapsed, type='boss'})
                        local dur = os.difftime(boss_fight_end[bname], boss_fight_start[bname])
                        gn_chat(('%s defeated (galli reward, %ds).'):format(bname, dur))
                        break
                    end
                end
            elseif galli_amt == 30000 then
                if not aminon_defeated then
                    aminon_defeated = true
                    fight_end_time = fight_end_time or os.time()
                    local duration = fight_start_time and os.difftime(fight_end_time, fight_start_time) or 0
                    gn_chat(('Aminon defeated (galli reward, %ds).'):format(duration))
                    local elapsed = sortie_start_time and math.floor(os.difftime(os.time(), sortie_start_time)) or 0
                    table.insert(sortie_enc.mini_nm_log, {name='Aminon', sector='Aminon', elapsed=elapsed, type='aminon'})
                end
            end

        else
        end
    end

    -- Drop tracking
    local lc = original:lower()
    local function log_drop(name)
        local elapsed = sortie_start_time and math.floor(os.difftime(os.time(), sortie_start_time)) or 0
        table.insert(sortie_enc.drop_log, {name=name, area=current_area or 'Unknown', elapsed=elapsed})
    end
    if lc:find("obtained:.*old case %+1") then
        drops.oldCasePlus1 = drops.oldCasePlus1 + 1
        log_drop("Old Case +1")
        gn_chat('Old Case +1 obtained!')
    elseif lc:find("obtained:.*old case") then
        drops.oldCase = drops.oldCase + 1
        log_drop("Old Case")
        gn_chat('Old Case obtained!')
    end
    if lc:find("obtained:.*kaznar sapphire") then
        drops.sapphire = drops.sapphire + 1
        log_drop("Ra'Kaznar Sapphire")
        gn_chat("Ra'Kaznar Sapphire obtained!")
    end
    if lc:find("obtained:.*kaznar starstone") then
        drops.starstone = drops.starstone + 1
        log_drop("Ra'Kaznar Starstone")
        gn_chat("Ra'Kaznar Starstone obtained!")
    end
    if lc:find("obtained:.*eikondrite") then
        drops.eikondrite = drops.eikondrite + 1
        log_drop("Eikondrite")
        gn_chat('Eikondrite obtained!')
    end
    if lc:find("obtained:.*octahedrite") then
        drops.octahedrite = drops.octahedrite + 1
        log_drop("Octahedrite")
        gn_chat('Octahedrite obtained!')
    end
    if lc:find("obtained:.*hexahedrite") then
        drops.hexahedrite = drops.hexahedrite + 1
        log_drop("Hexahedrite")
        gn_chat('Hexahedrite obtained!')
    end
    if lc:find("obtained:.*mesosiderite") then
        meso_count = meso_count + 1
        drops.mesosiderite = drops.mesosiderite + 1
        log_drop("Mesosiderite")
        gn_chat('Mesosiderite obtained!')
    end

    -- Temporary item drops: "You obtain the temporary item: Sheet of Ra'Kaznar metal #G!"
    local temp_item = original:match("[Yy]ou obtain the temporary item: (.-)!")
    if temp_item and temp_item ~= '' then
        temp_item = strip_escape_codes(temp_item):gsub('\239', '')  -- also drop FFXI auto-translate marker (0xEF)
        local elapsed = sortie_start_time and math.floor(os.difftime(os.time(), sortie_start_time)) or 0
        table.insert(sortie_enc.drop_log, {name=temp_item, area=current_area or 'Unknown', elapsed=elapsed, type='temp'})
        gn_chat(('Temp item: %s'):format(temp_item))
    end

    -- Track sector objective progress: '#A treasure coffer status report: 3/7'
    local sector_letter, obj_count = original:match('#(%u) treasure coffer status report: (%d+)/7')
    if sector_letter and obj_count and sector_objectives[sector_letter] ~= nil then
        sector_objectives[sector_letter] = tonumber(obj_count)
        gn_chat(('Sector %s objectives: %s/7'):format(sector_letter, obj_count))
    end

end)




-- Init everything on load --

gallimaufry_total = 0
party_jobs = {}
party_id_to_name = {}
coroutine.schedule(function()
    currency.request_update()
    coroutine.sleep(2)
    starting_galli = currency.display_values() or 0
end, 0)

-- Check if already inside Sortie when the addon loads
local init_zone = windower.ffxi.get_info().zone
local init_zone_info = res.zones[init_zone]
local init_zone_name = init_zone_info and init_zone_info.en or ''
in_sortie = init_zone_name:lower():find("ra'kaznar") ~= nil and (init_zone_name:find("%[U2%]") or init_zone_name:find("%[U3%]")) ~= nil
if in_sortie then
    sortie_start_time = os.time()
    sortie_points_start = ff_points_totals and ff_points_totals() or nil
    if ff_gear_start then sortie_gear_token = ff_gear_start(sortie_start_time) end
    sortie_enc.zone_log = {}
    enter_area('Ground Floor')
    if ff_live_state_open then
        ff_live_state_open({
            start_os       = sortie_start_time,
            source         = 'sortie',
            zone_name      = init_zone_name,
            get_deaths     = function() return #sortie_enc.death_log end,
            get_party_jobs = function() return party_jobs end,
        })
    end
end

do
    local ok, err = pcall(function() dofile(windower.addon_path .. 'tracker.lua') end)
    if not ok then gn_chat_err('tracker.lua failed to load: ' .. tostring(err)) end
end