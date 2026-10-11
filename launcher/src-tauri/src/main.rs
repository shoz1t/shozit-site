// Лаунчер с окном: консоль не нужна ни в отладочной, ни в релизной сборке Windows.
#![windows_subsystem = "windows"]

fn main() {
    shozit_launcher_lib::run()
}
