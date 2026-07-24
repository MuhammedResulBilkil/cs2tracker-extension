local logger = require("logger")
local millennium = require("millennium")

local LOG_PREFIX = "CS2Tracker Extension: "

local function on_load()
    millennium.ready()
    logger:info(LOG_PREFIX .. "loaded")
end

local function on_unload()
    logger:info(LOG_PREFIX .. "unloaded")
end

return {
    on_load = on_load,
    on_unload = on_unload,
}
