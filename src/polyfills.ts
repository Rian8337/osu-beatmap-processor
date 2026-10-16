// tsyringe needs the Reflect metadata polyfill before any module that imports it runs. Keeping the import in its own
// module makes the bundler run it before the shared chunks that contain tsyringe, which an import in an entry
// file's own body would not.
import "reflect-metadata";
