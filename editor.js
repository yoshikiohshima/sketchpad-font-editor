export function editor() {
    const preactModule = import('./preact.standalone.module.js');
    const html = preactModule.html;
    const render = preactModule.render;

    const selectButton = Events.listener(document.querySelector("#select"), "click", evt => evt);
    const lineButton = Events.listener(document.querySelector("#line"), "click", evt => evt);
    const arc2Button = Events.listener(document.querySelector("#arc2"), "click", evt => evt);
    const deleteButton = Events.listener(document.querySelector("#delete"), "click", evt => evt);

    const charClick = Events.listener(document.querySelector("#chars"), "click", evt => evt);

    const dragRequest = Events.receiver();

    const exampleStringInput = Events.listener(document.querySelector("#exampleEditor"), "input", evt => evt);

    const exampleString = Behaviors.collect(document.querySelector("#exampleEditor").textContent, exampleStringInput, (_old, v) => v.target.textContent);

    const toolState = Behaviors.collect(
        "line",
        Events.or(selectButton, lineButton, arc2Button, deleteButton),
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

    const charData = Behaviors.collect({selected: " ", segs: [], data: new Map()}, Events.or(charSelected, Events.change($segments)), (current, change) => {
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

    const griddedMap = (evt) => {
        const rect = evt.target.getBoundingClientRect();
        const gridX = gridSpec.width / gridSpec.x;
        const gridY = gridSpec.height / gridSpec.y;
        const x = Math.max(0, Math.round((evt.clientX - rect.x - (gridX/2)) / gridX));
        const y = gridSpec.y - 1 - Math.round((evt.clientY - rect.y - (gridY / 2)) / gridY);
        return {x, y, target: evt.target};
    };

    const toCharCoordinates = (evt) => {
        const rect = evt.target.getBoundingClientRect();
        const gridX = gridSpec.width / gridSpec.x;
        const gridY = gridSpec.height / gridSpec.y;
        const x = (evt.clientX - rect.x - (gridX/2)) / gridX;
        const y = gridSpec.y - 1 - ((evt.clientY - rect.y - (gridY / 2)) / gridY);
        return {x, y, target: evt.target};
    };

    const griddedUnmap = (p, useRect) => {
        const gridX = gridSpec.width / gridSpec.x;
        const gridY = gridSpec.height / gridSpec.y;
        let offset;
        if (useRect) {
            const rect = p.target.getBoundingClientRect();
            offset = {x: rect.x, y: rect.y};
        } else {
            offset = {x: 0, y: 0};
        }
        return {
            x: p.x * gridX + (gridX/2) + offset.x,
            y: (gridSpec.y - p.y - 1) * gridY + (gridY/2) + offset.y
        }
    };

    const interactionBuffer = Events.collect({command: "line", points: [], state: null}, Events.or(editorDown, Events.change(toolState)), (points, evt) => {
        if (typeof evt === "string") {
            return {command: evt, points: [], state: null};
        }
        const shiftKey = evt.shiftKey;
        const p = griddedMap(evt);
        const newPoints = [...points.points, p];
        if (points.command === "select") {
            return {command: "select", points: [], state: p};
        }
        if (points.command === "line") {
            if (points.points.length === 0) {
                return {command: "line", points: newPoints, state: null};
            }
            if (points.points.length === 1) {
                return {command: "line", points: [], state: newPoints, shiftKey};
            }
        } else if (points.command === "arc2") {
            if (points.points.length === 0 || points.points.length === 1) {
                return {command: "arc2", points: newPoints, state: null};
            }
            if (points.points.length === 2) {
                return {command: "arc2", points: [], state: newPoints, shiftKey};
            }
        } else if (points.command === "delete") {
            return {command: "delete", points: [], state: [toCharCoordinates(evt)], shiftKey};
        }
    });

    const hit = (seg, p) => {
        const hitLine = (p1, p2, p) => {
            const threshold = 0.1;
            const dist = Math.abs(
                (p2.y - p1.y) * p.x -
                    (p2.x - p1.x) * p.y +
                    p2.x * p1.y -
                    p2.y * p1.x)
                  /
                  Math.sqrt((p2.y - p1.y) ** 2 + (p2.x - p1.x) ** 2);
            const xIn = p1.x >= p2.x ?
                  p.x >= p2.x - threshold && p1.x + threshold > p.x :
                  p.x >= p1.x - threshold && p2.x + threshold > p.x;
            const yIn = p1.y >= p2.y ?
                  p.y >= p2.y - threshold && p1.y + threshold > p.y :
                  p.y >= p1.y - threshold && p2.y + threshold > p.y;
            return xIn && yIn && dist < threshold;
        };
        if (seg.command === "line") {
            const ps = seg.state;
            const p1 = ps[0];
            const p2 = ps[1];
            return hitLine(p1, p2, p);
        } else if (seg.command === "arc2") {
            const threshold = 0.5;
            const ps = seg.state;
            const center = ps[0];
            const start = ps[1];
            const end = ps[2];
            const shiftKey = seg.shiftKey;

            if (Math.abs(distance(start, center) - distance(p, center)) > threshold) return false;

            const rot = rotation(start, end, center);
            const pRot = rotation(start, p, center);
            return pRot < rot;
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
        return winding ? Math.PI * 2 - diff: diff;;
    }

    const arcData = (seg) => {
        const ps = seg.state;
        const center = ps[0];
        const start = ps[1];
        const control = ps[2];
        const shiftKey = seg.shiftKey;

        const r = distance(center, start);
        const rot = rotation(start, control, center);

        const startRad = Math.atan2(start.y - center.y, start.x - center.x);
        const endRad = Math.atan2(control.y - center.y, control.x - center.x);

        const end = {x: r * Math.cos(endRad) + center.x, y: r * Math.sin(endRad) + center.y};

        if (Math.abs(rot) < 0.001) {
            return makeCircle(griddedUnmap(center), griddedUnmap(start), html);
        }

        return {command: "arc2", center, radius: r, start: startRad, end: endRad, shiftKey};
    }

    const segments = Behaviors.collect([], Events.or(interactionBuffer, Events.change(charData), dragRequest), (segs, change) => {
        if (change.dragRequest === true) {
            console.log("dragRequest", change);
            const newSegs = [...segs];
            console.log("setting", newSegs[change.maybeSelect.index] === change.maybeSelect.segment);
            newSegs[change.maybeSelect.index].center = change.gridded;
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
            const found = false;
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

        if (buffer.command === "select") {
            return segs;
        }

        if (buffer.command === "arc2") {
            return [...segs, arcData(buffer)];
        }
        return [...segs, buffer];
    });

    const maybeSelect = Behaviors.collect(null, Events.or(interactionBuffer, editorUp), (_old, buffer) => {
        if (toolState === "select" && buffer.state) {
            const p = buffer.state;
            for (let i = segments.length - 1; i >= 0; i--) {
                const segment = segments[i];
                if (segment.command === "arc2") {
                    const {start, end, radius, center} = segment;
                    const threshold = 0.1;
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
                }
            }
        }
        return null;
    });

    console.log(maybeSelect);

    const dragObject = ((evt) => {
        const gridded = griddedMap(evt);
        if (!maybeSelect) {return;}

        if (maybeSelect.type === "center") {
            console.log(maybeSelect);
            Events.send(dragRequest, {dragRequest: true, maybeSelect, gridded});
        }
    })(editorMove);

    const makeLine = (p1, p2, html) => {
        return html`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#ddd" stroke-width="${gridSpec.lineWidth}" stroke-linecap="round"></line>`;
    };

    const makeArc = (p1, p2, p3, long, sweep, html) => {
        const r = Math.sqrt((p1.x - p3.x) ** 2 + (p1.y - p3.y) ** 2);
        return html`<path d="M ${p1.x} ${p1.y} A ${r} ${r} 0 ${long ? "1" : "0"} ${sweep ? "1" : "0"} ${p2.x} ${p2.y}" stroke="#ddd" stroke-width="${gridSpec.lineWidth}" fill="transparent" stroke-linecap="round"></path>`;
    };

    const makeArc2 = (start, end, center, long, sweep, html) => {
        const r = distance(center, start);
        return html`<path d="M ${start.x} ${start.y} A ${r} ${r} 0 ${long ? "1" : "0"} ${sweep ? "1" : "0"} ${end.x} ${end.y}" stroke="#ddd" stroke-width="${gridSpec.lineWidth}" fill="transparent" stroke-linecap="round"></path>`;
    };

    const makeCircle = (center, p, html) => {
        return html`<circle cx="${center.x}" cy="${center.y}" r="${distance(center, p)}" stroke="#ddd" stroke-width="${gridSpec.lineWidth}" fill="transparent" stroke-linecap="round"></path>`;
    };

    const lines = (segs) => {
        return segs.map((seg) => {
            if (seg.command === "line") {
                const ps = seg.state;
                const p1 = griddedUnmap(ps[0]);
                const p2 = griddedUnmap(ps[1]);
                return makeLine(p1, p2, html);
            } if (seg.command === "arc2") {
                const {center, radius, start, end, shiftKey} = seg;

                const s = {x: Math.cos(start) * radius + center.x, y: Math.sin(start) * radius + center.y};
                const e = {x: Math.cos(end) * radius + center.x, y: Math.sin(end) * radius + center.y};

                const rot = rotation(s, e, center);
                if (Math.abs(rot) < 0.001) {
                    return makeCircle(griddedUnmap(center), griddedUnmap(start), html);
                }

                return makeArc2(griddedUnmap(s), griddedUnmap(e), griddedUnmap(center), shiftKey ? rot < Math.PI : rot > Math.PI, shiftKey, html);
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

    const gridMover = ((editorMove, toolState) => {
        const gridded = toolState === "delete" ? toCharCoordinates(editorMove) : griddedMap(editorMove);
        const p = griddedUnmap(gridded, true);
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
                const p1 = points[0];
                const p2 = points[1];
                const control = griddedMap(editorMove);
                const c = center(p1, p2, control);
                const shiftKey = editorMove.shiftKey;
                const dot = (control.x - p1.x) * (p2.x - control.x) + (control.y - p1.y) * (p2.y - control.y);
                if (c === null || Math.abs(dot) < 0.001) {
                    return makeLine(griddedUnmap(p1), griddedUnmap(p2), html);
                }
                const dA = {x: -(p1.y - c.y), y: p1.x - c.x};
                const cA = {x: control.x - c.x, y: control.y - c.y};
                const dir = (dA.x * cA.x + dA.y * cA.y) / Math.sqrt(dA.x ** 2 + dA.y ** 2) * Math.sqrt(cA.x ** 2 + cA.y ** 2);
                return makeArc(griddedUnmap(p1), griddedUnmap(p2), griddedUnmap(c),  shiftKey ? dot >= 0 : dot < 0, shiftKey ? dir >= 0 : dir < 0, html);
            }
        } else if (interactionBuffer.command === "arc2") {
            if (points.length === 1) {
                const p1 = griddedUnmap(points[0]);
                const p2 = griddedUnmap(griddedMap(editorMove));
                return makeLine(p1, p2, html);
            } else if (points.length === 2) {
                const center = points[0];
                const start = points[1];
                const control = griddedMap(editorMove);
                const shiftKey = editorMove.shiftKey;
                const dot = 1;

                const r = distance(center, start);
                const rot = rotation(start, control, center);

                const startRad = Math.atan2(start.y - center.y, start.x - center.x);
                const endRad = Math.atan2(control.y - center.y, control.x - center.x);

                const end = {x: r * Math.cos(endRad) + center.x, y: r * Math.sin(endRad) + center.y};

                if (Math.abs(rot) < 0.001) {
                    return makeCircle(griddedUnmap(center), griddedUnmap(start), html);
                }
                return makeArc2(griddedUnmap(start), griddedUnmap(end), griddedUnmap(center), shiftKey ? rot < Math.PI : rot > Math.PI, shiftKey, html);
            }
        }
        return makeLine({x: -1, y: -1}, {x: -1, y: -1}, html);
    })(Behaviors.keep(interactionBuffer), editorMove, html);

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
                ctx.ellipse((cellW/2) + i * cellW, (cellH/2) + j * cellH, r, r, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        for (let j = 0; j < y; j++) {
            ctx.fillText(`${y -1 - j}`, 0, (cellH/2) + j * cellH);
        }
        for (let i = 0; i < x; i++) {
            ctx.fillText(`${i}`, (cellW/2) + i * cellW, height - 5);
        }
        return myCanvas;
    }

    function center(p1, p2, p3) {
        let midAC = {x: (p3.x + p1.x) / 2, y: (p3.y + p1.y) / 2};
        let midBC = {x: (p3.x + p2.x) / 2, y: (p3.y + p2.y) / 2};
        let midAB = {x: (p2.x + p1.x) / 2, y: (p2.y + p1.y) / 2};

        let slopeAC = -(p3.x - p1.x) / (p3.y - p1.y); // inverse of the slope
        let slopeBC = -(p3.x - p2.x) / (p3.y - p2.y); // inverse of the slope

        if (Math.abs(slopeAC - slopeBC) < 0.001) {
            return null;
        }


        if (Math.abs(p3.y - p1.y) < 0.001) {
            // just find the case when the other line,
            // slopeBC * (x - midBC.x) + midBC.y = p3.y;
            // slopeBC * x - slopeBC * midBC.x = p3.y - midBC.y;
            // x = (slopeBC * midBC.x + p3.y - midBC.y) / slopeBC;
            // console.log("slopeBC", slopeBC);
            // if slopeBC is zero, that means that it is a right triangle. The center is the midpoint of AB;
            if (Math.abs(slopeBC) < 0.0001) {return midAB;}
            const x = midAC.x;
            const y = slopeBC * (x - midBC.x) + midBC.y;
            return {x, y};
        }

        if (Math.abs(p3.y - p2.y) < 0.001) {
            // just find the case when the other line,
            // slopeAC * (x - midAC.x) + midAC.y = p3.y;
            // slopeAC * x - slopeAC * midAC.x = p3.y - midAC.y;
            // x = (slopeAC * midAC.x + p3.y - midAC.y) / slopeAC;
            // console.log("slopeAC", slopeAC);
            // if slopeAC is zero, that means that it is a right triangle. The center is the midpoint of AB;
            if (Math.abs(slopeAC) < 0.0001) {return midAB;}
            const x = midBC.x;
            const y = slopeAC * (x - midAC.x) + midAC.y;
            return {x, y};
        }


        // y = slopeAC * (x - midAC.x) + midAC.y
        // y = slopeBC * (x - midBC.x) + midBC.y

        // slopeAC * (x - midAC.x) + midAC.y = slopeBC * (x - midBC.x) + midBC.y

        // slopeAC * x - slopeAC * midAC.x + midAC.y = slopeBC * x - slopeBC * midBC.x + midBC.y
        // slopeAC * x - slopeBC * x = slopeAC * midAC.x - midAC.y - slopeBC * midBC.x + midBC.y

        // (slopeAC - slopeBC) * x = slopeAC * midAC.x - midAC.y - slopeBC * midBC.x + midBC.y

        const x = (slopeAC * midAC.x - midAC.y - slopeBC * midBC.x + midBC.y) / (slopeAC - slopeBC);
        const y = slopeAC * (x - midAC.x) + midAC.y;

        if (Number.isNaN(x) || Number.isNaN(y)) {debugger;}

        return {x, y};
    }

    // console.log(rotation({x: 10, y: 5}, {x: 5, y: 10}, {x: 5, y: 5}));
    // console.log(rotation({x: 10, y: 4}, {x: 5, y: 10}, {x: 5, y: 5}));
    // console.log(rotation({x: 10, y: 4}, {x: 10, y: 3}, {x: 5, y: 5}));
    // console.log(rotation({x: 1, y: 4}, {x: 1, y: 6}, {x: 5, y: 5}));
    // console.log(rotation({x: 1, y: 6}, {x: 1, y: 4}, {x: 5, y: 5}));
    // console.log(rotation({x: 1, y: 6}, {x: 1, y: 4}, {x: 5, y: 5}, true));

    const gridCanvas = makeGridCanvas({...gridSpec, canvas: document.querySelector("#gridCanvas")});
    return []
}

/* globals console Events Behaviors document */
