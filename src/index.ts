import { run, signalExit } from './run';

run({
  init: () => { 
    return {
      text: "Hello world - Press TRIANGLE to close.",
      textPosition: {
        x: 5,
        y: 5
      },
      textColor: Color.new(255, 255, 255)
    } 
  },
  draw: (state) => {
    Graphics.debugPrint(state.textPosition.x, state.textPosition.y, state.text, state.textColor);
  },
  check: (state) => {
    let pad = Controls.read();
    if (Controls.check(pad, Ctrl.SCE_CTRL_TRIANGLE))
      signalExit();
  }
});