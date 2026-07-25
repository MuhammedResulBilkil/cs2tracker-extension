local logger = require("logger")
local millennium = require("millennium")
-- Millennium v3.3.1 preloads this as `json`. It is documented as `cjson` and the official
-- PluginTemplate ships a `---@meta` stub under that name, but nothing preloads it -- requiring
-- `cjson` kills the backend before it opens its IPC socket, with only an exit code to show for it.
local json = require("json")
local http = require("http")

local LOG_PREFIX = "CS2Tracker Extension: "

-- Must stay in sync with DEFAULT_SETTINGS in shared/settings.ts.
local DEFAULT_SETTINGS = {
    openExternal = false,
    showOnProfiles = true,
    showOnFriendLists = true,
}

local VANITY_PATTERN = "^[A-Za-z0-9_%-]+$"
local VANITY_MIN_LENGTH = 2
local VANITY_MAX_LENGTH = 32
local STEAM_VANITY_URL = "https://steamcommunity.com/id/%s/?xml=1"
local REQUEST_TIMEOUT_SECONDS = 10

local function apply_default_settings()
    for key, value in pairs(DEFAULT_SETTINGS) do
        if millennium.config.get(key) == nil then
            millennium.config.set(key, value)
        end
    end
end

local function current_settings()
    local settings = {}
    for key, fallback in pairs(DEFAULT_SETTINGS) do
        local value = millennium.config.get(key)
        if type(value) == "boolean" then
            settings[key] = value
        else
            settings[key] = fallback
        end
    end
    return settings
end

local function is_valid_vanity(vanity)
    if type(vanity) ~= "string" then
        return false
    end
    local length = #vanity
    if length < VANITY_MIN_LENGTH or length > VANITY_MAX_LENGTH then
        return false
    end
    return vanity:match(VANITY_PATTERN) ~= nil
end

-- Accept a boolean, or the two strings that spell one.
--
-- Millennium marshals RPC arguments as JSON across the IPC boundary and nothing on either side
-- of it is typed, so what arrives is whatever that build's marshaller produced. Rejecting
-- anything else rather than coercing is the point: `if value then` would read every non-empty
-- string as true, so a marshaller that started sending "false" would silently turn every
-- switch-off into a switch-on. nil means "unusable", which the caller reports and refuses.
local function to_boolean(value)
    if type(value) == "boolean" then
        return value
    end
    if value == "true" then
        return true
    end
    if value == "false" then
        return false
    end
    return nil
end

-- Global on purpose: Millennium resolves callable('GetSettings') by global
-- function name, not through this module's return table. Declaring it local
-- fails at runtime with "function not found".
function GetSettings()
    local ok, encoded = pcall(json.encode, current_settings())
    if ok and type(encoded) == "string" then
        return encoded
    end
    logger:error(LOG_PREFIX .. "failed to encode settings: " .. tostring(encoded))
    return "{}"
end

-- Global on purpose, same reason as GetSettings.
--
-- Write one setting and answer with the whole of what the store now holds.
--
-- Returning the settings rather than an acknowledgement is what lets the panel stay honest without
-- trusting itself: it shows the value it just wrote immediately, then adopts this reply. So a write
-- this function refuses -- an unknown key, an unusable value -- moves the switch back rather than
-- leaving the panel disagreeing with the config file, which is the failure the panel had before and
-- the one nobody can see from the outside.
--
-- DEFAULT_SETTINGS doubles as the allowlist. Without that test this is an arbitrary write into the
-- user's Millennium config under this plugin's name, steerable by whatever calls it; with it, the
-- only writable keys are the three this plugin ships. Indexing with a nil or a table is a plain nil
-- read in Lua, so a malformed key fails the test rather than the interpreter.
function SetSetting(key, value)
    if DEFAULT_SETTINGS[key] == nil then
        logger:warn(LOG_PREFIX .. "refused to write unknown setting: " .. tostring(key))
        return GetSettings()
    end

    local boolean_value = to_boolean(value)
    if boolean_value == nil then
        logger:warn(LOG_PREFIX .. "refused non-boolean value for " .. tostring(key) .. ": " .. tostring(value))
        return GetSettings()
    end

    -- pcall because a failed config write must still answer. Letting it propagate would reject the
    -- RPC, and the panel would then report "could not save" over a switch whose real state it no
    -- longer knows; answering with the store's own view says what actually happened.
    local ok, err = pcall(millennium.config.set, key, boolean_value)
    if not ok then
        logger:error(LOG_PREFIX .. "failed to write " .. tostring(key) .. ": " .. tostring(err))
    end

    return GetSettings()
end

-- Global on purpose, same reason as GetSettings.
-- The vanity is validated against a strict character class before it reaches
-- the URL, so this cannot be steered at another host or escape the path.
function ResolveVanity(vanity)
    if not is_valid_vanity(vanity) then
        return ""
    end

    local url = string.format(STEAM_VANITY_URL, vanity)
    local response, err = http.get(url, {
        timeout = REQUEST_TIMEOUT_SECONDS,
        follow_redirects = true,
        -- Already the library default; stated explicitly so that an audit of this
        -- request does not have to go read the http module to confirm it.
        verify_ssl = true,
    })

    if not response then
        logger:warn(LOG_PREFIX .. "vanity lookup failed: " .. tostring(err))
        return ""
    end

    -- Logged because a throttled or broken Steam is otherwise indistinguishable from a
    -- vanity that simply does not exist: both just make the link fail to appear.
    if response.status ~= 200 then
        logger:warn(LOG_PREFIX .. "vanity lookup returned HTTP " .. tostring(response.status))
        return ""
    end

    if type(response.body) ~= "string" then
        logger:warn(LOG_PREFIX .. "vanity lookup returned no body")
        return ""
    end

    -- A vanity with no match is a normal outcome, not a fault, so it stays quiet.
    local steam_id = response.body:match("<steamID64>(%d+)</steamID64>")
    if steam_id and #steam_id == 17 then
        return steam_id
    end

    return ""
end

local function on_load()
    local ok, err = pcall(apply_default_settings)

    -- Signal ready before anything else can fail, including the logging below. If on_load
    -- dies before this line Millennium waits forever, and a hung Steam client leaves the
    -- user nothing to diagnose it from.
    millennium.ready()

    if not ok then
        logger:error(LOG_PREFIX .. "failed to apply default settings: " .. tostring(err))
    end

    logger:info(LOG_PREFIX .. "loaded")
end

local function on_unload()
    logger:info(LOG_PREFIX .. "unloaded")
end

return {
    on_load = on_load,
    on_unload = on_unload,
    GetSettings = GetSettings,
    SetSetting = SetSetting,
    ResolveVanity = ResolveVanity,
}
