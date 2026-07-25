---@meta

--- Editor-only declarations for the JSON module Millennium preloads into the Lua backend.
---
--- Deliberately minimal. This file previously declared the full lua-cjson surface -- `cjson.safe`,
--- `encode_sparse_array`, `encode_max_depth`, `encode_number_precision` and the rest -- under the name
--- `cjson`, copied from the official PluginTemplate's stub. None of it was verified against a running
--- Millennium, and the module name itself was wrong: requiring `cjson` on v3.3.1 kills the backend
--- before it opens its IPC socket, leaving only an exit code.
---
--- So this stub now declares only what has been observed working under v3.3.1: `encode` and `decode`,
--- both used by installed plugins whose IPC sockets exist. If you need more of the surface, verify it
--- against a live backend first and add it with that evidence. A stub that promises more than the
--- runtime provides is worse than no stub, because the editor will happily autocomplete you into a
--- crash that reports nothing.

---@class json
local json = {}

--- Encode a Lua value as a JSON string.
---
--- Failure behaviour is unverified on this runtime -- lua-cjson raises, other implementations return
--- nil. Call it through `pcall` and check that the result is a string, which is correct either way.
---@param value any The Lua value to encode
---@return string encoded JSON string representation
function json.encode(value) end

--- Decode a JSON string into a Lua value. Same failure caveat as `encode`.
---@param json_string string The JSON string to decode
---@return any decoded The decoded Lua value
function json.decode(json_string) end

return json
