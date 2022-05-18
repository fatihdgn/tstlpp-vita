import { run, signalExit } from './run';
function filePathFromApp(path: string) { return `app0:/${path}`; }
run({
  init: () => {
    return {
      text: "Hello world - Press ENTER to close.",
      textPosition: {
        x: 5,
        y: 5
      },
      textColor: Color.new(255, 255, 255),
      enterCtrl: Controls.getEnterButton(),

      image: Graphics.loadImage(filePathFromApp("assets/100x100.png")),
      imagePosition: {
        x: 5,
        y: 50
      }
    }
  },
  draw: (state) => {
    Graphics.debugPrint(state.textPosition.x, state.textPosition.y, state.text, state.textColor);
    Graphics.drawImage(state.imagePosition.x, state.imagePosition.y, state.image);
  },
  check: (state) => {
    let pad = Controls.read();
    if (Controls.check(pad, state.enterCtrl))
      signalExit();
  }
});