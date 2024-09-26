export function editor() {
    const preactModule = import('./preact.standalone.module.js');
    const html = preactModule.html;
    const render = preactModule.render;

    const lineButton = Events.click("#line");
    const arcButton = Events.click("#arc");
    const deleteButton = Events.click("#delete");
    const charClick = Events.click("#chars");

    const toolState = Behaviors.collect(
        "line",
        Events.or(lineButton, arcButton, deleteButton),
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

    const selectedChar = Events.collect(" ", charClick, (old, evt) => {
        const id = evt.target.id;
        const match = /([0-9]+)/.exec(id);
        const n = parseFloat(match[1]);
        return String.fromCharCode(n);
    });

    const coordinateMap = (evt) => {
        const rect = evt.target.getBoundingClientRect();
        return {
            x: Math.floor(evt.x - rect.x) - 40,
            y: gridSpec.height - Math.floor(evt.y - rect.top - 40)
        }
    };
    
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
    }

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
        } else if (seg.command === "arc") {
            const threshold = 0.5;
            const ps = seg.state;
            const p1 = ps[0];
            const p2 = ps[1];
            const control = ps[2];
            const c = center(p1, p2, control);
            if (c === null) {
                return hitLine(p1, p2, p);
            }
            if (Math.abs(distance(p1, c) - distance(p, c)) > threshold) return false;
            const myC = center(p1, p2, p);
            if (distance(myC, c) > threshold) return false;
            return true;
        }
        return false;
    };

    const distance = (p1, p2) => Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);

    const segments = Behaviors.collect([], interactionBuffer, (segs, buffer) => {
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
        return [...segs, buffer];
    });

    const makeLine = (p1, p2, html) => {
        return html`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#ddd" stroke-width="${gridSpec.lineWidth}" stroke-linecap="round"></line>`;
    };

    const makeArc = (p1, p2, p3, long, sweep, html) => {
        const r = Math.sqrt((p1.x - p3.x) ** 2 + (p1.y - p3.y) ** 2);
        return html`<path d="M ${p1.x} ${p1.y} A ${r} ${r} 0 ${long ? "1" : "0"} ${sweep ? "1" : "0"} ${p2.x} ${p2.y}" stroke="#ddd" stroke-width="${gridSpec.lineWidth}" fill="transparent" stroke-linecap="round"></path>`;
    };

    const lines = segments.map((seg) => {
        if (seg.command === "line") {
            const ps = seg.state;
            const p1 = griddedUnmap(ps[0]);
            const p2 = griddedUnmap(ps[1]);
            return makeLine(p1, p2, html);
        }
        if (seg.command === "arc") {
            const ps = seg.state;
            const p1 = ps[0];
            const p2 = ps[1];
            const control = ps[2];
            const c = center(p1, p2, control);
            const shiftKey = seg.shiftKey;
            const dot = (control.x - p1.x) * (p2.x - control.x) + (control.y - p1.y) * (p2.y - control.y);
            if (c === null || Math.abs(dot) < 0.001) {
                return makeLine(griddedUnmap(p1), griddedUnmap(p2), html);
            }
            const dA = {x: -(p1.y - c.y), y: p1.x - c.x};
            const cA = {x: control.x - c.x, y: control.y - c.y};
            const dir = (dA.x * cA.x + dA.y * cA.y) / Math.sqrt(dA.x ** 2 + dA.y ** 2) * Math.sqrt(cA.x ** 2 + cA.y ** 2);
            return makeArc(griddedUnmap(p1), griddedUnmap(p2), griddedUnmap(c), shiftKey ? dot >= 0 : dot < 0, shiftKey ? dir >= 0 : dir < 0, html);
        }
    });

    const linesSVG = html`<svg viewBox="0 0 ${gridSpec.width} ${gridSpec.height}" xmlns="http://www.w3.org/2000/svg">${[...lines, rubberBandLine]}</svg>`;

    render(linesSVG, document.querySelector("#editorPane2"));

    const editorDown = Events.listener("#editorPane", "pointerdown", (evt) => evt);
    const editorMove = Events.listener("#editorPane", "pointermove", (evt) => evt);

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
        }
        return makeLine({x: 0, y: 0}, {x: 0, y: 0}, html);
    })(Behaviors.keep(interactionBuffer), editorMove, html);

    const rubberBandLine = Behaviors.collect(
        makeLine({x: 0, y: 0}, {x: 0, y: 0}, html),
        rubberBandUpdate,
        (_old, r) => r);
    
    const charEntry = (i, html) => {
        const c = String.fromCharCode(i);
        return html`<div class="charHolder" id="holder-${i}"><div class="charName">${c}</div><div class="charView"></div></div>`;
    }

    const charList = ((html, charEntry) => [...Array(96).keys()].map((i) => charEntry(i + 32, html)))(html, charEntry);

    const charsHTML = html`<div class="charViews">${charList}</div>`;

    render(charsHTML, document.querySelector("#chars"));

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
            console.log("slopeBC", slopeBC);
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
            console.log("slopeAC", slopeAC);
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
    
    const gridCanvas = makeGridCanvas({...gridSpec, canvas: document.querySelector("#gridCanvas")});
    return []
}