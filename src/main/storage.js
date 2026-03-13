/**
 * Storage facade redirect — all storage logic lives in ./storage/ subdirectory.
 * This file exists for backward compatibility with require('./storage').
 */
module.exports = require('./storage/index');
