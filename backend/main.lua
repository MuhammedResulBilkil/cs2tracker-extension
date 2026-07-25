local logger = require("logger")
local millennium = require("millennium")
local cjson = require("cjson")
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

-- Global on purpose: Millennium resolves callable('GetSettings') by global
-- function name, not through this module's return table. Declaring it local
-- fails at runtime with "function not found".
function GetSettings()
    local ok, encoded = pcall(cjson.encode, current_settings())
    if ok and type(encoded) == "string" then
        return encoded
    end
    logger:error(LOG_PREFIX .. "failed to encode settings: " .. tostring(encoded))
    return "{}"
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
    ResolveVanity = ResolveVanity,
}
