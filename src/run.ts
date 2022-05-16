import { IApp } from "./IApp";

let isRunning = true;
function signalExit() {
    isRunning = false;
}

function run<TState>(app: IApp<TState>): void {
    let state: TState = app.init();
    while (isRunning) {
        if (!!app.draw)
            _draw(state, app.draw);
        if (!!app.check)
            app.check(state);
    }
    System.exit();
}

function _draw<TState>(state: TState, cb: (state: TState) => void) {
    Graphics.initBlend();
    Screen.clear();
    cb(state);
    Graphics.termBlend();
    Screen.flip();
}


export {
    run,
    signalExit
};