-- helpers/init.lua
-- Add the sketchybar module to the package cpath
package.cpath = package.cpath .. ";/Users/" .. os.getenv("USER") .. "/.local/share/sketchybar_lua/?.so"

-- NOTE: Compilation of C helpers is disabled to ensure this config works
-- without the C source files. If you have the source files, you can uncomment below.
os.execute("(cd helpers && make)")
