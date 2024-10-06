// To recognize dom types (see https://bun.sh/docs/typescript#dom-types):
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { Motor, UpdatePayload } from "motor-loop"
import { newgrounds } from "./newgrounds";

const CELL_SIZE = 0.03;

const urlVars = new URLSearchParams(window.location.search);
const TOTAL_CREATURES = (Number.isNaN(urlVars.get("num")) ? 0 : parseInt(urlVars.get("num")!)) || 2;
const EMOJIS = ["😴","🥱","😔","😐","🙂","😊","😄","😂","🤣","🤪"];

// Vertex shader source code
const vertexShaderSource = `
attribute vec2 coordinates;
attribute vec2 textureCoord;
uniform vec2 position;
uniform float zoom;
varying vec2 vTextureCoord;
uniform vec2 offset;
void main(void) {
  gl_Position = vec4((coordinates + position + offset) * zoom, 0.0, 1.0);
  vTextureCoord = textureCoord;
}
`;

// Fragment shader source code
const fragmentShaderSource = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec3 light;
void main(void) {
  vec4 color = texture2D(uSampler, vTextureCoord);
  if (color.a < 0.5) {
    discard;
  }
  gl_FragColor = vec4(color.rgb + light * 0.3, color.a);
}
`;

export interface Member {
  x: number;
  y: number;
  rotation: number;
  creature: Creature;
}

const MEMBER_SIZE = [1, 1, 0, 1.1, 0, .9, .8];

let nextId = 1;
let thrillTotal = 0;
let love = 0;
let totalScore = 0;
let age = 0;

export class Symbol {
  x: number;
  y: number;
  rotation: number
  index: number;
  size: number = 1;
  born: number = 0;
  constructor({x,y,index,size, rotation, born}: {born: number; x: number, y: number, rotation: number, size: number, index: number}) {
    this.x = x;
    this.y = y;
    this.rotation = rotation;
    this.index = index;
    this.size = size;
    this.born = born;
  }
}

export class Creature {
  direction: number = 1;
  members: Member[] = [];
  skin: [number, number, number] = [0,0,0];
  mov: [number, number] = [0,0];
  timeStart = 0;
  id = nextId++;
  shown = 0;
  lastBounce = 0;
  spin = 0;
  influence = 0;
  thrillSpeed = 0;
  born = 0;

  getSize(time: number) {
    const dt = Math.max(0, Math.min(1, (time - this.born) / 10000));
    return .5 + dt * .5;
  }

  get x() {
    return this.members[0].x;
  }

  get y() {
    return this.members[0].y;
  }

  gravity() {
    this.mov[1] -= .05;
  }

  lastSymbol = 0;
  move(time: number, map: WorldMap, game: Game) {
    for (let i = this.members.length - 1; i > 0; i--) {
      this.members[i].x = this.members[i - 1].x;
      this.members[i].y = this.members[i - 1].y;
      this.members[i].rotation = this.members[i - 1].rotation;
    }
    const px = this.members[0].x + this.mov[0] * .01;
    const py = this.members[0].y + this.mov[1] * .01;
    const cell = this.collide(map, px, py, true);
    if (cell?.elem) {
      if (this.mov[1] < 0) {
        this.mov[1] = -this.mov[1] * .8;
      }
      const colLeft = this.collide(map, this.members[0].x - Math.abs(this.mov[0]) * .01, py)?.elem;
      const colRight = this.collide(map, this.members[0].y + Math.abs(this.mov[0]) * .01, py)?.elem;
      const freeDirection = (!!colLeft) === (!!colRight) ? 0 : colLeft ? 1 : -1;
      if (freeDirection) {
        this.mov[0] = Math.abs(this.mov[0]) * freeDirection * .01;
      } else if(colLeft && colRight) {
        this.mov[0] = -this.mov[0];
      } else {
        this.mov[0] = (Math.random() - .5) + this.influence * Math.random();
        this.mov[1] = (Math.random() - .5) * 2;
        this.influence *= .9;
      }
      this.lastBounce = time;
      cell.color[0] = Math.max(0, cell.color[0] - Math.random() * .1);
      cell.color[1] = Math.max(0, cell.color[1] - Math.random() * .1);
      cell.color[2] = Math.max(0, cell.color[2] - Math.random() * .1);
      if (!cell.color[0] && !cell.color[1] && !cell.color[2]) {
        cell.elem = undefined;
      }
    }
    this.members[0].x += this.mov[0] * .01;
    this.members[0].y += this.mov[1] * .01;
    this.members[0].rotation = Math.sin((this.timeStart + time) / 30) / 4;
    const speed = Math.abs(this.mov[1]);
    if (speed > this.thrillSpeed) {
      this.thrillSpeed = speed;
      thrillTotal += speed;
      if (time - this.lastSymbol > 500) {
        this.lastSymbol = time;
        game.createSymbol({
          x: this.x,
          y: this.y,
          index: 1,
          rotation: Math.random() - .5,
          size: 1 + Math.abs(this.thrillSpeed) / 10,
          born: time,
        });
      }
    }
    this.thrillSpeed *= .999999;
  }

  static DEFAULT_UNDERGROUND = {
    elem: true,
    color: [-3, -3, -3],
    ex: 0, ey: 0,
  };

  collide(map: WorldMap, px: number, py: number, autoCreate = false) {
    const step = 100;
    const cellX = Math.floor(px * step);
    const cellY = Math.floor(py * step);
    const elem = map.getElemAt(cellX, cellY);
    if (!elem) {
      if (py >= 0) {
        return elem;
      }
      if (!autoCreate) {
        return Creature.DEFAULT_UNDERGROUND;
      }
      const newElem = {
        ...Creature.DEFAULT_UNDERGROUND,
        color: [1, 1, 1],
      };
      map.setElemAt(newElem, cellX, cellY);
      return newElem;
    }
    return elem;
  }

  act(time: number, map: WorldMap, creatures: Creature[], game: Game) {
    if (Math.random() < .1) {
      if (time - this.lastBounce < 200) {
        this.mov[0] += (Math.random() - .5);
        this.mov[0] *= .9;
        this.mov[1] = (Math.random() - .5) * 2;
      }
      const randomCreature = creatures[Math.floor(Math.random() * creatures.length)];
      if (randomCreature !== this) {
        const dx = randomCreature.members[0].x - this.members[0].x;
        const dy = randomCreature.members[0].y - this.members[0].y;
        const distance = dx * dx + dy * dy;
        if (distance < .0005) {
          this.influence -= dx;
          const preLove = love;
          love += Math.abs(this.thrillSpeed/10);
          if (time - this.lastSymbol > 500 && Math.round(100 * preLove / creatures.length) !== Math.round(100 * love/ creatures.length)) {
            this.lastSymbol = time;
            game.createSymbol({
              x: this.x,
              y: this.y,
              index: 0,
              rotation: Math.random() - .5,
              size: 1 + Math.abs(this.thrillSpeed) / 10,
              born: time,
            });
          }

          if (love > creatures.length && this.getSize(time) >= .9) {
            love = 0;
            const light = Math.random() - .5, colorize = .5;
            const spe = light + colorize * (Math.random() - .5);
            game.createCreature(this.x, this.y, time, [
              Math.random() < .01 ? spe : Math.random() < .5 ? this.skin[0] : randomCreature.skin[0],
              Math.random() < .01 ? spe : Math.random() < .5 ? this.skin[1] : randomCreature.skin[1],
              Math.random() < .01 ? spe : Math.random() < .5 ? this.skin[2] : randomCreature.skin[2],
            ]);
          }
        }
      }
    }
  }

  adjustDirection() {
    this.direction = this.mov[0] > 0 ? 1 : -1;
  }

  swapX(x : number) {
    return this.direction < 0 ? .5 - x : x;
  }
}

interface Grid {
  gridX: number;
  gridY: number;
  grid: any[][];
}

class WorldMap {
  grids: Record<string, Grid> = {};

  addElem(elem: any, rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) {
    for (let xi = 0; xi < rect.width; xi++) {
      for (let yi = 0; yi < rect.height; yi++) {
        const ex = Math.floor(rect.x) + xi, ey = Math.floor(rect.y) + yi;
        // if (this.getElemAt(ex, ey)?.elem === elem) {
        //   continue;
        // }
        this.setElemAt({
          elem,
          color: [1, 1, 1],
          ex, ey,
        }, ex, ey);
      }
    }
  }

  setElemAt(elem: any, x: number, y: number) {
    const gridX = Math.floor(x / 100);
    const gridY = Math.floor(y / 100);
    const gridKey = `${gridX},${gridY}`;
    if (!this.grids[gridKey]) {
      this.grids[gridKey] = {
        gridX,
        gridY,
        grid: [],
      };
    }
    const grid = this.grids[gridKey];
    const cellX = x - gridX * 100;
    const cellY = y - gridY * 100;
    if (!grid.grid[cellY]) {
      grid.grid[cellY] = [];
    }
    grid.grid[cellY][cellX] = elem;
  }

  getGridAt(x: number, y: number) {
    const gridX = Math.floor(x / 100);
    const gridY = Math.floor(y / 100);
    const gridKey = `${gridX},${gridY}`;
    const grid = this.grids[gridKey];
    return grid;
  }

  getElemAt(x: number, y: number) {
    const grid = this.getGridAt(x, y);
    if (!grid) {
      return undefined;
    }
    const cellX = x - grid.gridX * 100;
    const cellY = y - grid.gridY * 100;
    return grid.grid[cellY] && grid.grid[cellY][cellX];
  }
}

export class Game {
  motor = new Motor(undefined, {
    frameRate: 60,
  });
  container;
  canvas;
  gl;
  texture: WebGLTexture | null = null;
  creatures: Creature[] = [
  ];
  symbols: Symbol[] = [];
  map = new WorldMap();
  mode: string = "SELECT";
  labelCount?: HTMLLabelElement;
  progressJoy?: HTMLDivElement;
  progressHeart?: HTMLDivElement;
  labelJoyValue?: HTMLLabelElement;
  labelJoyEmoji?: HTMLLabelElement;
  labelScore?: HTMLLabelElement;
  labelAge?: HTMLLabelElement;

  constructor() {
    document.body.style.backgroundColor = "#333333";
    this.container = document.body.appendChild(document.createElement("div"));
    this.container.style.flexDirection = "column";
    this.canvas = this.container.appendChild(document.createElement("canvas"));
    this.gl = this.canvas.getContext("webgl2")!;
    this.canvas.width = 1600;
    this.canvas.height = 1200;
    this.canvas.style.width = `${this.canvas.width / 2}px`;
    this.canvas.style.height = `${this.canvas.height / 2}px`;
    // Make canvas centered
    this.container.style.display = "flex";
    this.container.style.justifyContent = "center";
    this.container.style.alignItems = "center";
    this.container.style.height = "100vh";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
    //  make body not selectable, not scollable, ...
    document.body.style.userSelect = "none";
    document.body.style.overflow = "hidden";
    document.body.style.margin = "0";
    document.body.style.padding = "0";

    {
      const ui = this.container.appendChild(document.createElement("div"));
      ui.style.position = "absolute";
      ui.style.top = "10px";
      ui.style.left = "10px";
      ui.style.display = "flex";
      ui.style.flexDirection = "column";
      ui.style.pointerEvents = "none";

      {
        const label = ui.appendChild(document.createElement("label"));
        label.textContent = "SCORE: 0";
        label.style.color = "snow";
        label.style.fontWeight = "bold";
        this.labelScore = label;  
      }

      {
        const container = ui.appendChild(document.createElement("div"));
        container.style.display = "flex";
        container.style.alignItems = "center";
        container.style.width = "500px";
      
        const label = container.appendChild(document.createElement("label"));
        label.textContent = "❤️: ";
        label.style.color = "snow";
        label.style.marginRight = "8px";
      
        const progressBar = container.appendChild(document.createElement("div"));
        progressBar.style.flexGrow = "1";
        progressBar.style.height = "10px";
        progressBar.style.backgroundColor = "gray";
        progressBar.style.borderRadius = "5px";
        progressBar.style.overflow = "hidden";
      
        const progress = progressBar.appendChild(document.createElement("div"));
        progress.style.height = "100%";
        progress.style.width = "0%";
        progress.style.backgroundColor = "red";
        progress.style.borderRadius = "10px";
        this.progressHeart = progress;
      }
      
      {
        const container = ui.appendChild(document.createElement("div"));
        container.style.display = "flex";
        container.style.alignItems = "center";
        container.style.marginBottom = "8px";
      
        const label = container.appendChild(document.createElement("label"));
        label.textContent = "😊: ";
        label.style.color = "snow";
        label.style.marginRight = "8px";
        this.labelJoyEmoji = label;
      
        const progressBar = container.appendChild(document.createElement("div"));
        progressBar.style.flexGrow = "1";
        progressBar.style.height = "10px";
        progressBar.style.backgroundColor = "gray";
        progressBar.style.borderRadius = "5px";
        progressBar.style.overflow = "hidden";
      
        const progress = progressBar.appendChild(document.createElement("div"));
        progress.style.height = "100%";
        progress.style.width = "0%";
        progress.style.backgroundColor = "yellow";
        progress.style.borderRadius = "10px";
      
        const valueLabel = container.appendChild(document.createElement("label"));
        valueLabel.style.color = "snow";
        valueLabel.style.marginLeft = "8px";

        this.progressJoy = progress;
        this.labelJoyValue = valueLabel;
        this.labelJoyValue.style.color = "yellow";
      }

      {
        const label = ui.appendChild(document.createElement("label"));
        label.textContent = "";
        label.style.color = "snow";
        this.labelCount = label;  
      }
      {
        const label = ui.appendChild(document.createElement("label"));
        label.textContent = "";
        label.style.color = "snow";
        this.labelAge = label;
      }
    }

    {

      const buttons = this.container.appendChild(document.createElement("div"));
      const refreshCursor = () => {
        this.canvas.style.cursor = this.mode === "SELECT" ? "default" : this.mode === "DRAW" || this.mode === "ERASE" ? "none" : "default";
        buttons.childNodes.forEach(c => {
          (c as any).style.backgroundColor = c.textContent?.toUpperCase() === this.mode ? "white" : "transparent";
          (c as any).style.color = c.textContent?.toUpperCase() === this.mode ? "black" : "white";
        });
      };
      {
        const button = buttons.appendChild(document.createElement("button"));
        button.textContent = "Select";
        button.addEventListener("click", () => {
          this.mode = button.textContent!.toUpperCase();
          refreshCursor();
        });
      }
      {
        const button = buttons.appendChild(document.createElement("button"));
        button.textContent = "Draw";
        button.addEventListener("click", () => {
          this.mode = button.textContent!.toUpperCase();
          refreshCursor();
        });
      }
      {
        const button = buttons.appendChild(document.createElement("button"));
        button.textContent = "Erase";
        button.addEventListener("click", () => {
          this.mode = button.textContent!.toUpperCase();
          refreshCursor();
        });
      }
      {
        const range = buttons.appendChild(document.createElement("input"));
        range.id = "fps";
        range.type = "range";
        range.min = "0";
        range.max = "600";
        range.step = "60";
        range.value = "60";
        range.addEventListener("input", () => {
          this.resetFrameRate(parseInt(range.value));
          fpsLabel.textContent = range.value + "fps";
        });
        const fpsLabel = buttons.appendChild(document.createElement("label"));
        fpsLabel.textContent = "60fps";
        fpsLabel.htmlFor = "fps";
        fpsLabel.style.color = "snow";
      }
      {
        const button = buttons.appendChild(document.createElement("button"));
        button.textContent = "Export";
        button.addEventListener("click", () => {
          this.exportGame();
        });
      }
      {
        const button = buttons.appendChild(document.createElement("button"));
        button.textContent = "Import";
        button.addEventListener("click", () => {
          this.importGame();
        });
      }
      refreshCursor();
    }
  }

  initialized = false;
  shaderProgram: WebGLProgram | null = null;
  lastDanger = 0;

  timeout: Record<string, Timer> = {};
  scoreAndDebounce(score: () => number, board: string) {
    clearTimeout(this.timeout[board]);
    this.timeout[board] = setTimeout(() => {
      newgrounds.postScore(score(), board);
    }, 10000);
  }

  refresh(payload: UpdatePayload<Game>) {
    this.creatures.forEach(creature => creature.gravity());
    this.creatures.forEach(creature => creature.move(payload.time, this.map, this));
    this.creatures.forEach(creature => creature.adjustDirection());
    this.creatures.forEach(creature => creature.act(payload.time, this.map, this.creatures, this));

    thrillTotal *= 1 - (.000005 * (this.creatures.length + 5));
    totalScore += Math.round(thrillTotal / 1000 + Math.random()*Math.random());
    age++;

    if (!payload.renderFrame) {
      return;
    }
    {
      // Update the heart label and progress bar
      const lovePercentage = (love / this.creatures.length) * 100;
      this.progressHeart!.style.width = `${lovePercentage}%`;

      // Update the joy label and progress bar
      this.progressJoy!.style.width = `${thrillTotal / (this.creatures.length*100) * 100}%`;
      this.labelJoyValue!.textContent = `${Math.round(thrillTotal)} / ${this.creatures.length*100}`;

      if (payload.time > 5000) {
        // Update the joy emoji with EMOJIS
        const joyIndex = Math.min(EMOJIS.length-1,  Math.floor(EMOJIS.length * thrillTotal / (this.creatures.length*100)));
        this.labelJoyEmoji!.textContent = `${EMOJIS[joyIndex]}: `;

        //  Update joy label color
        if (joyIndex < 1) {
          this.progressJoy!.style.backgroundColor = Math.random() < .5 ? "red": "yellow";
          if (payload.time > 30000 && payload.time - this.lastDanger > 10000) {
            newgrounds.postScore(totalScore, "Score"); 
            alert("Game Over! Your tardigrades are too sad to continue.");
            this.motor.stopLoop?.();
          }
        } else if (joyIndex < 3) {
          this.progressJoy!.style.backgroundColor = "brown";
          this.lastDanger = payload.time;
        } else if (joyIndex < 5) {
          this.progressJoy!.style.backgroundColor = "orange";
          this.lastDanger = payload.time;
        } else if (joyIndex === 9) {
          this.progressJoy!.style.backgroundColor = "gold";
          this.lastDanger = payload.time;
        } else {
          this.progressJoy!.style.backgroundColor = "yellow";
          this.lastDanger = payload.time;
        }        
      }

      const year = Math.floor(age / 1000);

      this.labelScore!.textContent = `Score: ${totalScore}`;
      this.labelAge!.textContent = `Year: ${year}`;
      const savedYear = parseInt(localStorage.getItem("year") ?? "0");
      if (year > savedYear && year > 5) {
        localStorage.setItem("year", year.toString());
        this.scoreAndDebounce(() => Math.floor(age / 1000), "Year");
      }

    }
    

    const gl = this.gl;
    if (!this.initialized) {
      // Compile vertex shader
      const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(vertexShader, vertexShaderSource);
      gl.compileShader(vertexShader);

      // Compile fragment shader
      const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(fragmentShader, fragmentShaderSource);
      gl.compileShader(fragmentShader);

      // Create and link the program
      const shaderProgram = gl.createProgram()!;
      this.shaderProgram = shaderProgram;
      gl.attachShader(shaderProgram, vertexShader);
      gl.attachShader(shaderProgram, fragmentShader);
      gl.linkProgram(shaderProgram);
      gl.useProgram(shaderProgram);
      // Create a buffer and bind it
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

      // Bind the buffer and set the attributes
      const coord = gl.getAttribLocation(shaderProgram, "coordinates");
      gl.vertexAttribPointer(coord, 2, gl.FLOAT, false, 4 * 4, 0);
      gl.enableVertexAttribArray(coord);

      const textureCoord = gl.getAttribLocation(shaderProgram, "textureCoord");
      gl.vertexAttribPointer(textureCoord, 2, gl.FLOAT, false, 4 * 4, 2 * 4);
      gl.enableVertexAttribArray(textureCoord);

      // Bind the texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(gl.getUniformLocation(shaderProgram, "uSampler"), 0);
      this.initialized = true;
    }

    // Clear the canvas
    gl.clear(gl.COLOR_BUFFER_BIT);
    const positionUniform = gl.getUniformLocation(this.shaderProgram!, "position");
    const lightUniform = gl.getUniformLocation(this.shaderProgram!, "light");
    const zoomUniform = gl.getUniformLocation(this.shaderProgram!, "zoom");
    const offsetUniform = gl.getUniformLocation(this.shaderProgram!, "offset");

    gl.uniform1f(zoomUniform, Math.round(this.zoom * 1000) / 1000);
    gl.uniform2fv(offsetUniform, this.globalOffset);

    {
      const blockVertices = new Float32Array([
        -1/this.zoom, -1/this.zoom - this.globalOffset[1], .2499 * 2 / 5, .4999,
        1/this.zoom, -1/this.zoom - this.globalOffset[1], .2501 * 2 / 5, .4999,
        1/this.zoom, 0, .2501 * 2 / 5, .5001,
        -1/this.zoom, 0, .2499 * 2 / 5, .5001,
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, blockVertices, gl.STATIC_DRAW);
      gl.uniform2f(positionUniform, -this.globalOffset[0], 0);
      gl.uniform3fv(lightUniform, [1,2,2]);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }


    const blockSize = .008;
    const blockVertices = new Float32Array([
      -blockSize, -blockSize, .2499, .4999,
      blockSize, -blockSize, .2501, .4999,
      blockSize, blockSize, .2501, .5001,
      -blockSize, blockSize, .2499, .5001,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, blockVertices, gl.STATIC_DRAW);
    const light = [1,2,2];
    Object.values(this.map.grids).forEach(grid => {
      grid.grid.forEach((row, r) => {
        row?.forEach((cell, c) => {
          const elem = cell?.elem;
          const py = grid.gridY + r / 100;
          if (elem) {
            light[0] = 1 * cell.color[0];
            light[1] = 2 * cell.color[1];
            light[2] = 2 * cell.color[2];
          } else if (!cell && py < 0) {
            return;
          } else {
            light[0] = -3;
            light[1] = -3;
            light[2] = -3;            
          }
          gl.uniform3fv(lightUniform, light);
          gl.uniform2f(positionUniform, grid.gridX + c / 100, grid.gridY + r / 100);
          gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);              
      });
      });
    });



    const vertices = new Float32Array([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);

    const originalVertices: number[] = [];
    const rotatedVertices: number[] = [];
    const displayedCreatures: Creature[] = [];

    this.creatures.forEach(creature => {
      const edge = 1;
      const head = creature.members[0];
      const globalPosX = (head.x + this.globalOffset[0]) * this.zoom;
      const globalPosY = (head.y + this.globalOffset[1]) * this.zoom;
      if (globalPosY < -edge || globalPosY > edge || globalPosX < -edge || globalPosX > edge) {
        return;
      }

      displayedCreatures.push(creature);
      this.labelCount!.textContent = `Tardigrades: ${displayedCreatures.length}`;
      const tardigrades = parseInt(localStorage.getItem("tardigrades") ?? "0");
      if (this.creatures.length > 5 && this.creatures.length > tardigrades) {
        localStorage.setItem("tardigrades", this.creatures.length.toString());
        this.scoreAndDebounce(() => this.creatures.length, "Tardigrades");
        if (this.creatures.length >= 12) {
          newgrounds.unlockMedal("A dozen");
        } else if (this.creatures.length >= 100) {
          newgrounds.unlockMedal("100 Tardigrades");
        } else if (this.creatures.length >= 1000) {
          newgrounds.unlockMedal("1000 Tardigrades");
        }
      }
    });
    const limit = 1000;
    if (displayedCreatures.length > limit) {
      displayedCreatures.sort((a, b) => a.shown - b.shown);
      displayedCreatures.length = limit;
    }

    gl.uniform2f(positionUniform, 0, 0);
    displayedCreatures.forEach(creature => {
      creature.shown = payload.time;

      // Set the position of the sprite
      gl.uniform3fv(lightUniform, creature.skin);

      for (let index = creature.members.length - 1; index >= 0; index--) {
        if (MEMBER_SIZE[index] === 0) {
          continue;
        }
        const member = creature.members[index];
        const isHead = index === 0;
        const offset = isHead ? 0 : 0.5;

        // Define the vertices and texture coordinates for a small sprite
        const spriteSize = CELL_SIZE * MEMBER_SIZE[index] * creature.getSize(payload.time); // Adjust the size of the sprite
        // const rotation = Math.sin(payload.time / 100);//member.rotation;

        // // Calculate the rotation matrix
        const cos = Math.cos(member.rotation);
        const sin = Math.sin(member.rotation);

        // Define the original vertices
        originalVertices.length = 0;
        originalVertices.push(
          -spriteSize, -spriteSize,
          spriteSize, -spriteSize,
          spriteSize, spriteSize,
          -spriteSize, spriteSize,
        );

        // Apply rotation to the vertices
        rotatedVertices.length = 0;
        for (let i = 0; i < originalVertices.length; i += 2) {
          const x = originalVertices[i];
          const y = originalVertices[i + 1];
          const rotatedX = x * cos - y * sin;
          const rotatedY = x * sin + y * cos;
          rotatedVertices.push(rotatedX, rotatedY);
        }

        let v = 0;
        vertices[v++] = rotatedVertices[0] + member.x;
        vertices[v++] = rotatedVertices[1] + member.y;
        vertices[v++] = (creature.swapX(0.0) + offset) * 2 / 5;
        vertices[v++] = 1.0;
        vertices[v++] = rotatedVertices[2] + member.x;
        vertices[v++] = rotatedVertices[3] + member.y;
        vertices[v++] = (creature.swapX(0.5) + offset) * 2 / 5;
        vertices[v++] = 1.0;
        vertices[v++] = rotatedVertices[4] + member.x;
        vertices[v++] = rotatedVertices[5] + member.y;
        vertices[v++] = (creature.swapX(0.5) + offset) * 2 / 5;
        vertices[v++] = 0.0;
        vertices[v++] = rotatedVertices[6] + member.x;
        vertices[v++] = rotatedVertices[7] + member.y;
        vertices[v++] = (creature.swapX(0.0) + offset) * 2 / 5;
        vertices[v++] = 0.0;

        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        // Draw the sprite
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
      }
    });

    gl.uniform2f(positionUniform, 0, 0);
    gl.uniform3fv(lightUniform, [1,1,1]);
    this.symbols.forEach(symbol => {
      const spriteSize = CELL_SIZE * Math.min(2,symbol.size) / this.zoom;
      const rotation = symbol.rotation;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const originalVertices = [
        -spriteSize, -spriteSize,
        spriteSize, -spriteSize,
        spriteSize, spriteSize,
        -spriteSize, spriteSize,
      ];
      const rotatedVertices = [];
      for (let i = 0; i < originalVertices.length; i += 2) {
        const x = originalVertices[i];
        const y = originalVertices[i + 1];
        const rotatedX = x * cos - y * sin;
        const rotatedY = x * sin + y * cos;
        rotatedVertices.push(rotatedX, rotatedY);
      }
      const age = (payload.time - symbol.born) / 3000 * .1;
      const offset = (3 + symbol.index) / 5;
      let v = 0;
      vertices[v++] = rotatedVertices[0] + symbol.x;
      vertices[v++] = rotatedVertices[1] + symbol.y + age;
      vertices[v++] = 0.0 + offset;
      vertices[v++] = 1;
      vertices[v++] = rotatedVertices[2] + symbol.x;
      vertices[v++] = rotatedVertices[3] + symbol.y + age;
      vertices[v++] = 0.2 + offset;
      vertices[v++] = 1;
      vertices[v++] = rotatedVertices[4] + symbol.x;
      vertices[v++] = rotatedVertices[5] + symbol.y + age;
      vertices[v++] = 0.2 + offset;
      vertices[v++] = 0.0;
      vertices[v++] = rotatedVertices[6] + symbol.x;
      vertices[v++] = rotatedVertices[7] + symbol.y + age;
      vertices[v++] = 0.0 + offset;
      vertices[v++] = 0.0;
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    });    

    if (this.mode === "DRAW" || this.mode === "ERASE") {
      const [x, y] = this.cursor;
      const blockSize = .05;
      const blockVertices = new Float32Array([
        -blockSize, -blockSize, .2499, .4999,
        blockSize, -blockSize, .2501, .4999,
        blockSize, blockSize, .2501, .5001,
        -blockSize, blockSize, .2499, .5001,
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, blockVertices, gl.STATIC_DRAW);
      gl.uniform2f(positionUniform, x, y);
      gl.uniform3fv(lightUniform, [this.mode === "DRAW" ? Math.random() / 2 : 1,Math.random(),Math.random()]);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }

    const [x, y] = this.offsetTarget;
    const [gx, gy] = this.globalOffset;
    this.offsetTarget[0] -= x * this.zoom;
    this.offsetTarget[1] -= y * this.zoom;
    this.globalOffset[0] -= gx * this.zoom;
    this.globalOffset[1] -= gy * this.zoom;
    this.zoom += (this.zoomTarget - this.zoom) * .1;
    this.offsetTarget[0] += x * this.zoom;
    this.offsetTarget[1] += y * this.zoom;
    this.globalOffset[0] += gx * this.zoom;
    this.globalOffset[1] += gy * this.zoom;
    this.globalOffset[0] += (this.offsetTarget[0] - this.globalOffset[0]) * .2;
    this.globalOffset[1] += (this.offsetTarget[1] - this.globalOffset[1]) * .2;

    this.symbols = this.symbols.filter(symbol => {
      return payload.time - symbol.born < 3000;
    });
  }

  async prepare() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Load the sprite sheet
    const image = new Image();
    image.src = 'tardigrades.png';
    await new Promise((resolve) => {
      image.onload = resolve;
    });

    // Create a texture
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.texture = texture; 
    
    document.addEventListener("wheel", (event) => {
      this.zoomTarget += event.deltaY * -0.001;
      this.zoomTarget = Math.min(Math.max(.1, this.zoomTarget), 4);
      event.stopPropagation();
      event.preventDefault();
    }, { passive: false });
    
    let pointDown: [number, number] | null = null;
    document.addEventListener("mousedown", (event) => {
      pointDown = [event.clientX, event.clientY];
    });
    document.addEventListener("mouseup", () => {
      pointDown = null;
    });
    const scrollMultiplier = 5;
    document.addEventListener("mousemove", (event) => {
      this.cursor[0] = (((event.clientX - this.canvas.offsetLeft) * 2 / this.canvas.width - .5) * 2) / this.zoom  - this.globalOffset[0];
      this.cursor[1] = (-((event.clientY - this.canvas.offsetTop) * 2 / this.canvas.height - .5) * 2) / this.zoom - this.globalOffset[1];
      if (pointDown && this.mode === "SELECT") {
        this.offsetTarget[0] += (event.clientX - pointDown[0]) / (this.canvas.width) * scrollMultiplier / this.zoom;
        this.offsetTarget[1] += -(event.clientY - pointDown[1]) / (this.canvas.height) * scrollMultiplier / this.zoom;
        pointDown[0] = event.clientX;
        pointDown[1] = event.clientY;
      }
      if (event.buttons === 1 && (this.mode === "DRAW" || this.mode === "ERASE")) {
        const x = this.cursor[0];
        const y = this.cursor[1];
        const cellX = Math.floor(x * 100);
        const cellY = Math.floor(y * 100);
        this.map.addElem(this.mode === "DRAW", {
          x: cellX-3,
          y: cellY-3,
          width: 7,
          height: 7,
        });
      }
    });

    const HIGHWALL = 200;
    const WALLSIZE = 30;
    this.map.addElem(true, {
      x: -HIGHWALL,
      y: -1,
      width: WALLSIZE,
      height: HIGHWALL,
    });
    this.map.addElem(true, {
      x: HIGHWALL,
      y: -1,
      width: WALLSIZE,
      height: HIGHWALL,
    });
    this.map.addElem(true, {
      x: -HIGHWALL,
      y: -1,
      width: HIGHWALL * 2,
      height: WALLSIZE,
    });
  }
  zoom = 1;
  zoomTarget = 1;
  offsetTarget = [0, 0];
  globalOffset = [0, 0];
  cursor = [0, 0];
  

  createCreature(x?: number, y?: number, born?: number, skin?: [number, number, number]) {
    const creature = new Creature();
    const light = Math.random() - .5, colorize = .3;
    creature.skin = skin ?? [
      light + colorize * (Math.random() - .5),
      light + colorize * (Math.random() - .5),
      light + colorize * (Math.random() - .5),
    ];
    creature.direction = Math.random() > .5 ? 1 : -1;
    creature.timeStart = Math.random() * 1000;
    creature.born = born ?? -10000;
    creature.lastSymbol = creature.born;
    const size = .01;
    const member: Member = {
      creature,
      x: x ?? (Math.random() - .5) * .2,
      y: y ?? 1,
      rotation:(Math.random() - .5) * .5,
    };
    creature.mov = [Math.random() - .5, Math.random() - .5];
    for (let i = 0; i < MEMBER_SIZE.length; i++) {
      creature.members.push(i === 0 ? member : 
        {
          creature,
          x: creature.members[i - 1].x + (Math.random() - .5) * size,
          y: creature.members[i - 1].y + (Math.random() - .5) * size,
          rotation: member.rotation * (Math.random() - .5) * .1,
        }
      );
    }
    this.creatures.push(creature);    
    return creature;
  }

  createSymbol({ x, y, index, rotation, size, born }: {
    x: number;
    y: number;
    index: number;
    rotation: number;
    size: number;
    born: number;
  }) {
    const symbol = new Symbol({
      x, y, index, rotation, size, born
    });
    this.symbols.push(symbol);
    return symbol;
  }

  async prepareCreatures() {
    for (let i = 0; i < TOTAL_CREATURES; i++) {
      const creature = this.createCreature();
      creature.lastSymbol = 5000;
    }
  }

  private startLoop() {
    this.motor.loop<Game>({
      refresh: (payload) => this.refresh(payload),
    }, this);
    this.motor.startLoop();
  }

  async start() {
    await this.prepare();
    await this.prepareCreatures();
    this.startLoop();
  }

  resetFrameRate(frameRate: number) {
    this.motor.stopLoop?.();
    if (frameRate) {
      this.motor = new Motor(undefined, {
        frameRate,
      });
      this.startLoop();  
    }
  }

  exportGame() {
    const data = {
      creatures: this.creatures.map(creature => ({
        members: creature.members.map(member => ({
          x: member.x,
          y: member.y,
          rotation: member.rotation,
        })),
        skin: creature.skin,
        timeStart: creature.timeStart,
        born: creature.born,
      })),
      map: Object.values(this.map.grids).map(grid => ({
        gridX: grid.gridX,
        gridY: grid.gridY,
        grid: grid.grid.map(row => row?.map(cell => cell ? ({
          elem: !!cell.elem,
          color: cell.color,
          ex: cell.ex,
          ey: cell.ey,
        }) : null)),
      })),
    };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "game.json";
    a.click();
  }

  importGame() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      const text = await file.text();
      const data = JSON.parse(text);
      this.creatures = data.creatures.map((creatureData: any) => {
        const creature = new Creature();
        creature.skin = creatureData.skin;
        creature.timeStart = creatureData.timeStart;
        creature.born = creatureData.born;
        creature.members = creatureData.members.map((memberData: any) => ({
          creature,
          x: memberData.x,
          y: memberData.y,
          rotation: memberData.rotation,
        }));
        return creature;
      });
      this.map = new WorldMap();
      data.map.forEach((gridData: any) => {
        const grid: Grid = {
          gridX: gridData.gridX,
          gridY: gridData.gridY,
          grid: gridData.grid.map((row: any, r: number) => row?.map((cell: any, c: number) => cell ? ({
            elem: !!cell.elem,
            color: cell.color,
            ex: cell.ex,
            ey: cell.ey,
          }) : undefined)),
        };
        this.map.grids[`${grid.gridX},${grid.gridY}`] = grid;
      });
    });
    input.click();
  }
}

export function HelloComponent() {
  return <></>;
}




//https://www.beepbox.co/#9n31sbk0l00e0ft3ea7g0fj07r1i0o432T1v1u3df0qwx10p511d08AcFbBfQ269cP969bE2bi7iT1v1uc1f10k8q011d23A1F0B4Q0050Pd66cE262972T1v1u63f0qwx10n511d08A1F1B4Q50b0Pea3bE2b7628T3v1uf7f0qwx10m711d08SZIztrsrzrqiiiiiE1b6b014h014h01404x804x95hh8i4zci4zcP4h4h4g004h4p22oFE-RBdBdldldldldldg2CLW5Wqfy18U0zxieyG1AXZMzF8Wr2eUzK8WaHHHJMYXVMLIbXi-ULO8LIbXO-ML5d7McK2cKjcKIOZoOU4OUkOVcOZMzF8Xie08XieQzI8Wyc5d6s8W2ewzE8W2ewzE8W2c0
