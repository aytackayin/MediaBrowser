// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // Suppress verbose Tao/Winit logs on Windows
  if std::env::var("RUST_LOG").is_err() {
    std::env::set_var("RUST_LOG", "error");
  }
  app_lib::run();
}
