export function editor() {
    const preactModule = import("./preact.standalone.module.js");
    const {stringify, parse} = import ("./stable-stringify.js");

    const html = preactModule.html;
    const render = preactModule.render;

    const selectButton = Events.listener(document.querySelector("#select"), "click", evt => evt);
    const lineButton = Events.listener(document.querySelector("#line"), "click", evt => evt);
    const arcButton = Events.listener(document.querySelector("#arc"), "click", evt => evt);
    const deleteButton = Events.listener(document.querySelector("#delete"), "click", evt => evt);
    const undoButton = Events.listener(document.querySelector("#undo"), "click", evt => evt);

    const charClick = Events.listener(document.querySelector("#chars"), "click", evt => evt);

    const saveButton = Events.listener(document.querySelector("#saveButton"), "click", evt => evt);
    const loadButton = Events.listener(document.querySelector("#loadButton"), "click", evt => evt);

    const dragRequest = Events.receiver();
    const fileLoadRequest = Events.receiver();
    const undoRequest = Events.receiver();

    console.log(undoRequest);

    const exampleStringInput = Events.listener(document.querySelector("#exampleEditor"), "input", evt => evt);

    const exampleString = Behaviors.collect(document.querySelector("#exampleEditor").textContent, exampleStringInput, (_old, v) => v.target.textContent);

    const toolState = Behaviors.collect(
        "line",
        Events.or(selectButton, lineButton, arcButton, deleteButton),
        (old, evt) => evt.target.id
    );

    // toolHighlighter
    ((toolState) => {
        for (const child of [...document.querySelector("#tools").childNodes]) {
            if (child.setAttribute) {
                child.setAttribute("toolSelected", child.id === toolState ? "true" : "false");
            }
        }
    })(toolState);

    console.log(toolState);

    const charSelected = Events.collect(" ", charClick, (old, evt) => {
        const id = evt.target.id;
        const match = /([0-9]+)/.exec(id);
        const n = parseFloat(match[1]);
        return String.fromCharCode(n);
    });

    console.log(charSelected);

    const charData = Behaviors.collect({selected: " ", segs: [], data: new Map()}, Events.or(charSelected, Events.change($segments), fileLoadRequest), (current, change) => {
        if (change.type === "fileLoad") {
            return {selected: current.selected, segs: change.data.data.get(current.selected) || [], data: change.data.data}
        }
        if (typeof change === "string") {
            // selected char changed
            if (current.selected === change) {return current;}
            current.data.set(current.selected, current.segs);
            return {selected: change, segs: current.segs, data: current.data}
        }
        // segments updated
        current.data.set(current.selected, change);
        return {selected: current.selected, segs: change, data: current.data};
    });

    const griddedMap = (evt, half) => {
        const f = half ? 2 : 1;
        const rect = evt.target.getBoundingClientRect();
        const gridX = gridSpec.width / (gridSpec.x * f);
        const gridY = gridSpec.height / (gridSpec.y * f);
        const x = Math.max(0, Math.round((evt.clientX - rect.x - (gridX / 2)) / gridX));
        const y = (gridSpec.y * f) - 1 - Math.round((evt.clientY - rect.y - (gridY / 2)) / gridY);

        return {x: x / f, y: y / f, target: evt.target};
    };

    const toCharCoordinates = (evt) => {
        const rect = evt.target.getBoundingClientRect();
        const gridX = gridSpec.width / gridSpec.x;
        const gridY = gridSpec.height / gridSpec.y;
        const x = (evt.clientX - rect.x - (gridX / 2)) / gridX;
        const y = gridSpec.y - 1 - ((evt.clientY - rect.y - (gridY / 2)) / gridY);
        return {x, y, target: evt.target};
    };

    const griddedUnmap = (p, dom) => {
        const gridX = gridSpec.width / gridSpec.x;
        const gridY = gridSpec.height / gridSpec.y;
        let offset;
        if (dom) {
            const rect = dom.getBoundingClientRect();
            offset = {x: rect.x, y: rect.y};
        } else {
            offset = {x: 0, y: 0};
        }
        return {
            x: p.x * gridX + (gridX / 2) + offset.x,
            y: (gridSpec.y - p.y - 1) * gridY + (gridY / 2) + offset.y
        }
    };

    const interactionBuffer = Events.collect({command: "line", points: [], state: null}, Events.or(editorDown, Events.change(toolState)), (points, evt) => {
        if (typeof evt === "string") {
            return {command: evt, points: [], state: null};
        }
        const shiftKey = evt.shiftKey;
        const p = griddedMap(evt);
        const coord = toCharCoordinates(evt);
        const newPoints = [...points.points, p];
        if (points.command === "select") {
            return {command: "select", points: [], state: coord};
        }
        if (points.command === "line") {
            if (points.points.length === 0) {
                return {command: "line", points: newPoints, state: null};
            }
            if (points.points.length === 1) {
                return {command: "line", points: [], state: newPoints, shiftKey};
            }
        } else if (points.command === "arc") {
            if (points.points.length === 0 || points.points.length === 1) {
                return {command: "arc", points: newPoints, state: null};
            }
            if (points.points.length === 2) {
                return {command: "arc", points: [], state: newPoints, shiftKey};
            }
        } else if (points.command === "delete") {
            return {command: "delete", points: [], state: [toCharCoordinates(evt)], shiftKey};
        }
    });

    const hit = (seg, p) => {
        if (seg.command === "line") {
            const threshold = 0.25;
            const p1 = seg.start;
            const p2 = seg.end;
            return distance(p1, p) < threshold || distance(p2, p) < threshold;
        } else if (seg.command === "arc") {
            const threshold = 0.25;
            const {center, start, end, radius} = seg;
            const s = {x: Math.cos(start) * radius + center.x, y: Math.sin(start) * radius + center.y};
            const e = {x: Math.cos(end) * radius + center.x, y: Math.sin(end) * radius + center.y};

            if (distance(center, p) < threshold) {return true}
            if (distance(s, p) < threshold) {return true}
            if (distance(e, p) < threshold) {return true}
        }
        return false;
    };

    const distance = (p1, p2) => Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    const rotation = (p1, p2, center, winding) => {
        let n1 = Math.atan2(p1.y - center.y, p1.x - center.x);
        let n2 = Math.atan2(p2.y - center.y, p2.x - center.x);

        if (Math.sign(n1) !== Math.sign(n2)) {
            n1 = Math.PI * 2 + n1;
            n2 = Math.PI * 2 + n2;
        }
        let diff = n2 - n1;
        if (diff < 0) {diff += Math.PI * 2}
        return winding ? Math.PI * 2 - diff : diff;
    }

    const lineData = (seg) => {
        const ps = seg.state;
        const start = ps[0];
        const end = ps[1];
        return {command: "line", start: {x: start.x, y: start.y}, end: {x: end.x, y: end.y}};
    }

    const arcData = (seg) => {
        const ps = seg.state;
        /*
        const center = ps[0];
        const start = ps[1];
        const control = ps[2];
        */

        const start = ps[0];
        const control = ps[2];
        const center = {x: (start.x + ps[1].x) / 2, y: (start.y + ps[1].y) / 2};

        const r = distance(center, start);

        const startRad = Math.atan2(start.y - center.y, start.x - center.x);
        let endRad = Math.atan2(control.y - center.y, control.x - center.x);

        if (Math.abs(startRad - endRad) < 0.001) {
            endRad = startRad + Math.PI * 2;
        }
        return {command: "arc", center: {x: center.x, y: center.y}, radius: r, start: startRad, end: endRad};
    }

    const segments = Behaviors.collect([], Events.or(interactionBuffer, Events.change(charData), dragRequest, undoRequest), (segs, change) => {
        if (change.type === "undo") {
            return [...change.obj];
        }
        if (change.dragRequest) {
            const newSegs = [...segs];
            const newEntry = {...newSegs[change.index]};
            if (change.segment.command === "arc") {
                if (change.dragRequest === "center") {
                    newEntry.center = change.gridded;
                }
                if (change.dragRequest === "start") {
                    newEntry.radius = change.radius;
                    newEntry.start = change.start;
                }
                if (change.dragRequest === "end") {
                    newEntry.radius = change.radius;
                    newEntry.end = change.end;
                }
            }
            if (change.segment.command === "line") {
                if (change.dragRequest === "start") {
                    newEntry.start = {x: change.start.x, y: change.start.y};
                }
                if (change.dragRequest === "end") {
                    newEntry.end = {x: change.end.x, y: change.end.y};
                }
            }
            newSegs[change.index] = newEntry;
            return newSegs;
        }
        if (change.selected !== undefined) {
            // charData changed
            const maybe = change.data.get(change.selected);
            if (!maybe) {return [];}
            return maybe;
        }
        const buffer = change;
        if (!buffer.state) {return segs;}
        if (buffer.command === "delete") {
            const p = buffer.state[0];
            for (let index = segs.length - 1; index >= 0; index--) {
                const seg = segs[index];
                if (hit(seg, p)) {
                    const result = [...segs];
                    result.splice(index, 1);
                    return result;
                }
            }
            return segs;
        }

        if (buffer.command === "line") {
            return [...segs, lineData(buffer)];
        }

        if (buffer.command === "select") {
            return segs;
        }

        if (buffer.command === "arc") {
            return [...segs, arcData(buffer)];
        }
        return [...segs, buffer];
    });

    const undoState = Behaviors.collect([], Events.or(undoRequest, Events.change(segments)), (old, segsOrUndo) => {
        if (segsOrUndo.type === "undo") {
            return old.slice(0, old.length - 1);
        }
        return [...old, segsOrUndo];
    });

    const _undoObj = ((_ev) => {
        if (undoState.length === 0) {return;}
        if (undoState.length === 1) {return;}
        Events.send(undoRequest, {type: "undo", obj: undoState[undoState.length - 2]});
    })(undoButton);

    const maybeSelect = Behaviors.collect(null, Events.or(interactionBuffer, editorUp), (_old, buffer) => {
        if (toolState === "select" && buffer.state) {
            const p = buffer.state;
            for (let i = segments.length - 1; i >= 0; i--) {
                const segment = segments[i];
                if (segment.command === "arc") {
                    const {start, end, radius, center} = segment;
                    const threshold = 0.25;
                    const s = {x: Math.cos(start) * radius + center.x, y: Math.sin(start) * radius + center.y};
                    const e = {x: Math.cos(end) * radius + center.x, y: Math.sin(end) * radius + center.y};

                    if (distance(segment.center, p) < threshold) {
                        return {index: i, segment, type: "center", point: p}
                    }
                    if (distance(s, p) < threshold) {
                        return {index: i, segment, type: "start", point: p}
                    }
                    if (distance(e, p) < threshold) {
                        return {index: i, segment, type: "end", point: p}
                    }
                }
                if (segment.command === "line") {
                    const {start, end} = segment;
                    const threshold = 0.25;
                    if (distance(start, p) < threshold) {
                        return {index: i, segment, type: "start", point: p}
                    }
                    if (distance(end, p) < threshold) {
                        return {index: i, segment, type: "end", point: p}
                    }
                }
            }
        }
        return null;
    });

    console.log(maybeSelect);

    const _dragObject = ((evt) => {
        const gridded = griddedMap(evt);
        if (!maybeSelect) {return;}

        if (maybeSelect.segment.command === "arc") {
            if (maybeSelect.type === "center") {
                // console.log(maybeSelect);
                const halfGridded = griddedMap(evt, true);
                Events.send(dragRequest, {dragRequest: "center", ...maybeSelect, gridded: halfGridded});
                return;
            }
            if (maybeSelect.type === "start") {
                // console.log("start", maybeSelect);
                const {center, radius} = maybeSelect.segment;
                const coord = toCharCoordinates(evt)

                const newRadius = radius;
                const newStart = Math.atan2(coord.y - center.y, coord.x - center.x);
                Events.send(dragRequest, {dragRequest: "start", ...maybeSelect, radius: newRadius, start: newStart});
                return;
            }
            if (maybeSelect.type === "end") {
                // console.log("end", maybeSelect);
                const {center, radius} = maybeSelect.segment;
                const coord = toCharCoordinates(evt)
                const newRadius = radius;
                const newEnd = Math.atan2(coord.y - center.y, coord.x - center.x);
                Events.send(dragRequest, {dragRequest: "end", ...maybeSelect, radius: newRadius, end: newEnd});
                return;
            }
        }
        if (maybeSelect.segment.command === "line") {
            if (maybeSelect.type === "start") {
                Events.send(dragRequest, {dragRequest: "start", ...maybeSelect, start: gridded});
                return;
            }
            if (maybeSelect.type === "end") {
                Events.send(dragRequest, {dragRequest: "end", ...maybeSelect, end: gridded});
                return;
            }
        }
    })(editorMove);

    const makeLine = (p1, p2, html) => {
        return html`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#ddd" stroke-width="${gridSpec.lineWidth}" stroke-linecap="round"></line>`;
    };

    const makeArc = (start, end, center, long, sweep, html) => {
        const r = distance(center, start);
        if (distance(start, end) < 0.001) {
            return makeCircle(center, start, html);
        }
        return html`<path d="M ${start.x} ${start.y} A ${r} ${r} 0 ${long ? "1" : "0"} ${sweep ? "1" : "0"} ${end.x} ${end.y}" stroke="#ddd" stroke-width="${gridSpec.lineWidth}" fill="transparent" stroke-linecap="round"></path>`;
    };

    const makeCircle = (center, p, html) => {
        return html`<circle cx="${center.x}" cy="${center.y}" r="${distance(center, p)}" stroke="#ddd" stroke-width="${gridSpec.lineWidth}" fill="transparent" stroke-linecap="round"></path>`;
    };

    const lines = (segs) => {
        return segs.map((seg) => {
            if (seg.command === "line") {
                const p1 = griddedUnmap(seg.start);
                const p2 = griddedUnmap(seg.end);
                return makeLine(p1, p2, html);
            } if (seg.command === "arc") {
                const {center, radius, start, end, shiftKey} = seg;

                const s = {x: Math.cos(start) * radius + center.x, y: Math.sin(start) * radius + center.y};
                const e = {x: Math.cos(end) * radius + center.x, y: Math.sin(end) * radius + center.y};

                const rot = rotation(s, e, center);

                return makeArc(griddedUnmap(s), griddedUnmap(e), griddedUnmap(center), shiftKey ? rot < Math.PI : rot > Math.PI, shiftKey, html);
            }
        });
    };

    const linesSVG = ((segments, lines) => {
        const ls = lines(segments);
        return html`<svg viewBox="0 0 ${gridSpec.width} ${gridSpec.height}" xmlns="http://www.w3.org/2000/svg">${[...ls, rubberBandLine]}</svg>`;
    })(segments, lines);

    render(linesSVG, document.querySelector("#editorPane2"));

    const editorDown = Events.listener("#editorPane", "pointerdown", (evt) => evt);
    const editorMove = Events.listener("#editorPane", "pointermove", (evt) => evt);
    const editorUp = Events.listener("#editorPane", "pointerup", (evt) => evt);

    const _gridMover = ((editorMove, toolState) => {
        const gridded = toolState === "delete" ? toCharCoordinates(editorMove) : griddedMap(editorMove);
        const p = griddedUnmap(gridded, document.querySelector("#editorPane"));
        const gridCursor = document.querySelector("#gridCursor");
        gridCursor.style.left = `${p.x - 5}px`;
        gridCursor.style.top = `${p.y - 5}px`;
    })(editorMove, toolState);

    const rubberBandUpdate = ((interactionBuffer, editorMove, html) => {
        const points = interactionBuffer.points;
        if (interactionBuffer.command === "line") {
            if (points.length === 1) {
                const p1 = griddedUnmap(points[0]);
                const p2 = griddedUnmap(griddedMap(editorMove));
                return makeLine(p1, p2, html);
            }
        } else if (interactionBuffer.command === "arc") {
            if (points.length === 1) {
                const p1 = griddedUnmap(points[0]);
                const p2 = griddedUnmap(griddedMap(editorMove));
                return makeLine(p1, p2, html);
            } else if (points.length === 2) {

                const start = points[0];
                const center = {x: (start.x + points[1].x) / 2, y: (start.y + points[1].y) / 2};
                const control = griddedMap(editorMove);

                /*
                const center = points[0];
                const start = points[1];
                const control = griddedMap(editorMove);
                */
                const shiftKey = editorMove.shiftKey;

                const r = distance(center, start);
                const rot = rotation(start, control, center);

                const endRad = Math.atan2(control.y - center.y, control.x - center.x);

                const end = {x: r * Math.cos(endRad) + center.x, y: r * Math.sin(endRad) + center.y};

                return makeArc(griddedUnmap(start), griddedUnmap(end), griddedUnmap(center), shiftKey ? rot < Math.PI : rot > Math.PI, shiftKey, html);
            }
        }
        return makeLine({x: -1, y: -1}, {x: -1, y: -1}, html);
    })(Behaviors.keep(interactionBuffer), editorMove, html);

    const _highlightControls = ((editorMove, toolState, segments) => {
        const highlight1 = document.querySelector("#highlight1");
        highlight1.style.display = "none";
        const highlight2 = document.querySelector("#highlight2");
        highlight2.style.display = "none";
        const highlight3 = document.querySelector("#highlight3");
        highlight3.style.display = "none";
        if (toolState !== "select" && toolState !== "delete") {return;}
        const p = toCharCoordinates(editorMove);

        const editorPane = document.querySelector("#editorPane");

        for (let index = segments.length - 1; index >= 0; index--) {
            const seg = segments[index];
            if (hit(seg, p)) {
                if (seg.command === "arc") {
                    const {start, end, radius, center} = seg;
                    const s = {x: Math.cos(start) * radius + center.x, y: Math.sin(start) * radius + center.y};
                    const e = {x: Math.cos(end) * radius + center.x, y: Math.sin(end) * radius + center.y};

                    let p = griddedUnmap(center,  editorPane);

                    highlight1.style.display = "inherit";
                    highlight1.style.left = `${p.x - 5}px`;
                    highlight1.style.top = `${p.y - 5}px`;

                    p = griddedUnmap(s,  editorPane);
                    highlight2.style.display = "inherit";
                    highlight2.style.left = `${p.x - 5}px`;
                    highlight2.style.top = `${p.y - 5}px`;

                    p = griddedUnmap(e,  editorPane);
                    highlight3.style.display = "inherit";
                    highlight3.style.left = `${p.x - 5}px`;
                    highlight3.style.top = `${p.y - 5}px`;
                    return;
                } else if (seg.command === "line") {
                    const {start, end} = seg;
                    let p = griddedUnmap(start, editorPane);
                    highlight1.style.display = "inherit";
                    highlight1.style.left = `${p.x - 5}px`;
                    highlight1.style.top = `${p.y - 5}px`;

                    p = griddedUnmap(end, editorPane);
                    highlight2.style.display = "inherit";
                    highlight2.style.left = `${p.x - 5}px`;
                    highlight2.style.top = `${p.y - 5}px`;
                }
                return;
            }
        }
        return;
    })(editorMove, toolState, segments);

    const rubberBandLine = Behaviors.collect(
        makeLine({x: 0, y: 0}, {x: 0, y: 0}, html),
        rubberBandUpdate,
        (_old, r) => r);

    const charEntry = (i, charData, html) => {
        const c = String.fromCharCode(i);
        const segs = charData.data.get(c) || [];
        const ls = lines(segs);
        const isSelected = charData.selected === c ? "charSelected" : "";
        return html`<div class="charHolder" id="holder-${i}"><div class="charName ${isSelected}">${c}</div><div class="charView">
            ${html`<svg viewBox="0 0 ${gridSpec.width} ${gridSpec.height}" xmlns="http://www.w3.org/2000/svg">${ls}</svg>`}</div></div>`;
    }

    const charList = ((html, charEntry, charData) => [...Array(96).keys()].map((i) => charEntry(i + 32, charData, html)))(html, charEntry, charData);

    const charsHTML = html`<div class="charViews">${charList}</div>`;

    const exampleDisplay = ((charData, exampleString, html) => {
        const result = exampleString.split("").map((c) => {
            const segs = charData.data.get(c) || [];
            const ls = lines(segs);
            const svg = html`<svg viewBox="0 0 ${gridSpec.width} ${gridSpec.height}" xmlns="http://www.w3.org/2000/svg">${ls}</svg>`;
            return  html`<div class="exampleCharHolder"><div class="exampleChar">${svg}</div></div>`;
        });

        return html`<div class="exampleView">${result}</div>`;
    })(charData, exampleString, html);

    render(charsHTML, document.querySelector("#chars"));
    render(exampleDisplay, document.querySelector("#example"));

    function makeGridCanvas(options) {
        const {width, height, x, y, radius, canvas} = options;
        const cellW = width / x;
        const cellH = height / y;

        const r = radius || 2;

        // each cell is in the size of (cellW, cellH)
        // the center of the dot is ((cellW/2) + i * cellW, (cellH/2) + j * cellH)
        // where i is [0..x] and j is [0..y]

        const myCanvas = canvas || document.createElement("canvas");
        myCanvas.width = width;
        myCanvas.height = height;
        const ctx = myCanvas.getContext("2d");

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#bbb";

        for (let j = 0; j < y; j++) {
            for (let i = 0; i < x; i++) {
                ctx.beginPath();
                ctx.ellipse((cellW / 2) + i * cellW, (cellH / 2) + j * cellH, r, r, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        for (let j = 0; j < y; j++) {
            ctx.fillText(`${y - 1 - j}`, 0, (cellH / 2) + j * cellH);
        }
        for (let i = 0; i < x; i++) {
            ctx.fillText(`${i}`, (cellW / 2) + i * cellW, height - 5);
        }
        return myCanvas;
    }

    makeGridCanvas({...gridSpec, canvas: document.querySelector("#gridCanvas")});

    const _saver = ((charData) => {
        const data = stringify({version: 1, data: charData.data});
        const div = document.createElement("a");
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(data);
        div.setAttribute("href", dataStr);
        div.setAttribute("download", `sketchpad-font.json`);
        div.click();
    })(charData, saveButton);

    const _loader = (() => {
        const input = document.createElement("div");
        input.innerHTML = `<input id="imageinput" type="file" accept="application/json">`;
        const imageInput = input.firstChild;

        imageInput.onchange = () => {
            const file = imageInput.files[0];
            if (!file) {return;}
            new Promise(resolve => {
                let reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsArrayBuffer(file);
            }).then((data) => {
                const result = new TextDecoder("utf-8").decode(data);
                Events.send(fileLoadRequest, {type: "fileLoad", data: parse(result)});
            })
            imageInput.value = "";
        };
        document.body.appendChild(imageInput);
        imageInput.click();
    })(loadButton);
    return []
}

/* globals console Events Behaviors document gridSpec $segments FileReader TextDecoder */
