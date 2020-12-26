export default class App {
    run(): void {
        let white = Color.new(255, 255, 255);

        while (true) {
            Graphics.initBlend();
            Screen.clear();
            Graphics.debugPrint(5, 5, "Hello world - Press TRIANGLE to close.", white);
            Graphics.termBlend();
            Screen.flip();

            // Check for input
            let pad = Controls.read();
            if (Controls.check(pad, Ctrl.SCE_CTRL_TRIANGLE))
                break
        }
    }
}