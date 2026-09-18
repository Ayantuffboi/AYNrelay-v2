const RELAY_URL =
    "wss://my-relay.ayan6-4.workers.dev";

const ICE_SERVERS = [
    {
        urls: [
            "stun:stun.cloudflare.com:3478",
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302"
        ]
    }
];

const codeInput =
    document.getElementById("code");

const connectButton =
    document.getElementById("connect");

const status =
    document.getElementById("status");

const login =
    document.getElementById("login");

const viewer =
    document.getElementById("viewer");

const screen =
    document.getElementById("screen");

const connectionStatus =
    document.getElementById("connectionStatus");

const fullscreenButton =
    document.getElementById("fullscreen");

let ws = null;
let pc = null;
let controlChannel = null;

function setStatus(message) {
    status.textContent = message;
    connectionStatus.textContent = message;
}

/*
 * IMPORTANT:
 * Accept any 8 characters.
 *
 * There is intentionally NO special alphabet filter here.
 */
function validCode(code) {
    return code.length === 8;
}

function sendSignal(data) {

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
    }

    ws.send(JSON.stringify({
        type: "signal",
        data
    }));
}

function createPeer() {

    pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require"
    });

    pc.ontrack = event => {

        if (event.streams.length > 0) {

            screen.srcObject =
                event.streams[0];

            screen.play().catch(() => {});

            connectionStatus.textContent =
                "Connected";
        }
    };

    pc.onconnectionstatechange = () => {

        connectionStatus.textContent =
            "WebRTC: " + pc.connectionState;

        if (pc.connectionState === "connected") {

            connectionStatus.textContent =
                "Connected";
        }

        if (
            pc.connectionState === "failed" ||
            pc.connectionState === "disconnected"
        ) {

            connectionStatus.textContent =
                "Connection lost";
        }
    };

    /*
     * The host creates the control data channel.
     * The client receives it here.
     */
    pc.ondatachannel = event => {

        if (event.channel.label !== "control") {
            return;
        }

        controlChannel =
            event.channel;

        controlChannel.onopen = () => {

            connectionStatus.textContent =
                "Connected - controls ready";
        };
    };
}

async function waitForIceGathering() {

    if (!pc) {
        return;
    }

    if (pc.iceGatheringState === "complete") {
        return;
    }

    await new Promise(resolve => {

        const check = () => {

            if (pc.iceGatheringState === "complete") {

                pc.removeEventListener(
                    "icegatheringstatechange",
                    check
                );

                resolve();
            }
        };

        pc.addEventListener(
            "icegatheringstatechange",
            check
        );
    });
}

async function handleSignal(data) {

    if (!pc) {
        createPeer();
    }

    if (data.type === "offer") {

        await pc.setRemoteDescription({
            type: "offer",
            sdp: data.sdp
        });

        const answer =
            await pc.createAnswer();

        await pc.setLocalDescription(answer);

        await waitForIceGathering();

        sendSignal({
            type: "answer",
            sdp: pc.localDescription.sdp
        });

        return;
    }

    if (data.type === "candidate") {

        try {

            await pc.addIceCandidate(
                data.candidate
            );

        } catch (error) {

            console.error(
                "ICE candidate error:",
                error
            );
        }
    }
}

function connectToRelay(code) {

    const url =
        RELAY_URL +
        "?code=" +
        encodeURIComponent(code);

    ws =
        new WebSocket(url);

    ws.onopen = () => {

        setStatus(
            "Connected to relay. Looking for PC..."
        );

        ws.send(JSON.stringify({
            type: "client-register",
            clientId: crypto.randomUUID()
        }));
    };

    ws.onmessage = async event => {

        let message;

        try {
            message =
                JSON.parse(event.data);
        } catch {
            return;
        }

        if (message.type === "host-online") {

            setStatus(
                "PC found. Connecting..."
            );

            createPeer();

            /*
             * Tell the host that this client is ready.
             */
            ws.send(JSON.stringify({
                type: "client-ready"
            }));

            return;
        }

        if (message.type === "signal") {

            await handleSignal(
                message.data
            );

            return;
        }

        if (message.type === "host-offline") {

            setStatus(
                "The PC disconnected."
            );

            return;
        }

        if (message.type === "error") {

            setStatus(
                message.message
            );
        }
    };

    ws.onerror = () => {

        setStatus(
            "Could not connect to relay."
        );
    };

    ws.onclose = () => {

        if (
            !pc ||
            pc.connectionState !== "connected"
        ) {

            setStatus(
                "Relay connection closed."
            );
        }
    };
}

connectButton.onclick = () => {

    const code =
        codeInput.value;

    if (!validCode(code)) {

        status.textContent =
            "The code must be exactly 8 characters.";

        return;
    }

    /*
     * Do NOT convert the code to a special alphabet.
     * Any characters are accepted.
     */
    login.classList.add("hidden");
    viewer.classList.remove("hidden");

    connectionStatus.textContent =
        "Connecting...";

    connectToRelay(code);
};

/*
 * Keyboard control
 */
document.addEventListener("keydown", event => {

    if (!controlChannel) {
        return;
    }

    if (controlChannel.readyState !== "open") {
        return;
    }

    /*
     * Don't let the browser navigate away while
     * controlling the remote PC.
     */
    if (
        event.key === "F5" ||
        event.key === "F11" ||
        event.key === "F12"
    ) {
        return;
    }

    event.preventDefault();

    controlChannel.send(JSON.stringify({
        type: "key",
        action: "down",
        key: event.key,
        code: event.code
    }));
});

document.addEventListener("keyup", event => {

    if (!controlChannel) {
        return;
    }

    if (controlChannel.readyState !== "open") {
        return;
    }

    event.preventDefault();

    controlChannel.send(JSON.stringify({
        type: "key",
        action: "up",
        key: event.key,
        code: event.code
    }));
});

/*
 * Mouse movement
 */
screen.addEventListener("mousemove", event => {

    if (!controlChannel) {
        return;
    }

    if (controlChannel.readyState !== "open") {
        return;
    }

    const rect =
        screen.getBoundingClientRect();

    const x =
        (event.clientX - rect.left) /
        rect.width;

    const y =
        (event.clientY - rect.top) /
        rect.height;

    controlChannel.send(JSON.stringify({
        type: "mouse",
        action: "move",
        x,
        y
    }));
});

/*
 * Mouse buttons
 */
screen.addEventListener("mousedown", event => {

    if (!controlChannel) {
        return;
    }

    if (controlChannel.readyState !== "open") {
        return;
    }

    event.preventDefault();

    controlChannel.send(JSON.stringify({
        type: "mouse",
        action: "down",
        button: event.button
    }));
});

screen.addEventListener("mouseup", event => {

    if (!controlChannel) {
        return;
    }

    if (controlChannel.readyState !== "open") {
        return;
    }

    event.preventDefault();

    controlChannel.send(JSON.stringify({
        type: "mouse",
        action: "up",
        button: event.button
    }));
});

/*
 * Wheel
 */
screen.addEventListener(
    "wheel",
    event => {

        if (!controlChannel) {
            return;
        }

        if (controlChannel.readyState !== "open") {
            return;
        }

        event.preventDefault();

        controlChannel.send(JSON.stringify({
            type: "mouse",
            action: "wheel",
            deltaX: event.deltaX,
            deltaY: event.deltaY
        }));
    },
    {
        passive: false
    }
);

fullscreenButton.onclick = () => {

    if (screen.requestFullscreen) {

        screen.requestFullscreen();
    }
};
