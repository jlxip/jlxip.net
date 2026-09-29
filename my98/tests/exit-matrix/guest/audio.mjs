export function quietAudio() {
    const connect = AudioNode.prototype.connect;
    const sinks = new WeakMap();
    AudioNode.prototype.connect = function(destination, ...args) {
        if(destination === this.context.destination) {
            let sink = sinks.get(this.context);
            if(!sink) {
                sink = this.context.createGain(); sink.gain.value = 0;
                connect.call(sink, destination); sinks.set(this.context, sink);
            }
            destination = sink;
        }
        return connect.call(this, destination, ...args);
    };
}

