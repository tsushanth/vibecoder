// 3D Model Generator App
class ModelGenerator {
    constructor() {
        this.currentImage = null;
        this.currentImageData = null;
        this.currentModel = null;
        this.gl = null;
        this.camera = {
            rotationX: -0.5,
            rotationY: 0.3,
            distance: 3,
            targetRotationX: -0.5,
            targetRotationY: 0.3,
            targetDistance: 3
        };
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.animationFrame = null;

        this.init();
    }

    init() {
        // DOM elements
        this.uploadArea = document.getElementById('uploadArea');
        this.imageInput = document.getElementById('imageInput');
        this.uploadSection = document.getElementById('uploadSection');
        this.modelOptions = document.getElementById('modelOptions');
        this.viewerSection = document.getElementById('viewerSection');
        this.canvas = document.getElementById('canvas3d');
        this.modelTypeSelect = document.getElementById('modelType');
        this.detailLevel = document.getElementById('detailLevel');
        this.depthIntensity = document.getElementById('depthIntensity');
        this.generateBtn = document.getElementById('generateBtn');
        this.resetViewBtn = document.getElementById('resetViewBtn');
        this.exportBtn = document.getElementById('exportBtn');
        this.newModelBtn = document.getElementById('newModelBtn');
        this.modelInfo = document.getElementById('modelInfo');
        this.galleryGrid = document.getElementById('galleryGrid');

        // Event listeners
        this.imageInput.addEventListener('change', (e) => this.handleImageUpload(e));
        this.uploadArea.addEventListener('click', () => this.imageInput.click());
        this.generateBtn.addEventListener('click', () => this.generateModel());
        this.resetViewBtn.addEventListener('click', () => this.resetView());
        this.exportBtn.addEventListener('click', () => this.exportSTL());
        this.newModelBtn.addEventListener('click', () => this.newModel());

        this.detailLevel.addEventListener('input', (e) => {
            document.getElementById('detailValue').textContent = e.target.value;
        });

        this.depthIntensity.addEventListener('input', (e) => {
            document.getElementById('depthValue').textContent = e.target.value;
        });

        // Canvas controls
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this.onMouseUp());
        this.canvas.addEventListener('mouseleave', () => this.onMouseUp());
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e));

        // Touch controls
        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', () => this.onTouchEnd());

        // Load gallery
        this.loadGallery();
    }

    handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                this.currentImage = img;
                this.processImage(img);
                this.modelOptions.style.display = 'block';
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    processImage(img) {
        // Create canvas to extract image data
        const tempCanvas = document.createElement('canvas');
        const maxSize = 256;
        let width = img.width;
        let height = img.height;

        // Resize if needed
        if (width > maxSize || height > maxSize) {
            const ratio = Math.min(maxSize / width, maxSize / height);
            width = Math.floor(width * ratio);
            height = Math.floor(height * ratio);
        }

        tempCanvas.width = width;
        tempCanvas.height = height;
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        this.currentImageData = ctx.getImageData(0, 0, width, height);
    }

    generateModel() {
        if (!this.currentImageData) return;

        const modelType = this.modelTypeSelect.value;
        const detail = parseInt(this.detailLevel.value);
        const depth = parseFloat(this.depthIntensity.value);

        let vertices, indices, uvs, normals;

        switch (modelType) {
            case 'heightmap':
                ({ vertices, indices, uvs, normals } = this.createHeightmap(detail, depth));
                break;
            case 'extrude':
                ({ vertices, indices, uvs, normals } = this.createExtrude(detail, depth));
                break;
            case 'sphere':
                ({ vertices, indices, uvs, normals } = this.createSphere(detail));
                break;
            case 'cube':
                ({ vertices, indices, uvs, normals } = this.createCube());
                break;
        }

        this.currentModel = {
            vertices,
            indices,
            uvs,
            normals,
            texture: this.createTextureFromImage(),
            type: modelType,
            detail,
            depth
        };

        this.uploadSection.style.display = 'none';
        this.viewerSection.style.display = 'block';

        this.initWebGL();
        this.startRendering();

        this.modelInfo.textContent = `Vertices: ${vertices.length / 3} | Triangles: ${indices.length / 3}`;

        // Save to localStorage
        this.saveModel();
    }

    createHeightmap(detail, depthScale) {
        const vertices = [];
        const indices = [];
        const uvs = [];
        const normals = [];
        const data = this.currentImageData;
        const width = data.width;
        const height = data.height;

        // Create grid
        for (let y = 0; y < detail; y++) {
            for (let x = 0; x < detail; x++) {
                const u = x / (detail - 1);
                const v = y / (detail - 1);

                // Sample image
                const imgX = Math.floor(u * (width - 1));
                const imgY = Math.floor(v * (height - 1));
                const idx = (imgY * width + imgX) * 4;
                const brightness = (data.data[idx] + data.data[idx + 1] + data.data[idx + 2]) / (3 * 255);

                // Position
                const px = (u - 0.5) * 2;
                const py = brightness * depthScale * 0.5;
                const pz = (v - 0.5) * 2;

                vertices.push(px, py, pz);
                uvs.push(u, 1 - v);
            }
        }

        // Create indices
        for (let y = 0; y < detail - 1; y++) {
            for (let x = 0; x < detail - 1; x++) {
                const topLeft = y * detail + x;
                const topRight = topLeft + 1;
                const bottomLeft = (y + 1) * detail + x;
                const bottomRight = bottomLeft + 1;

                indices.push(topLeft, bottomLeft, topRight);
                indices.push(topRight, bottomLeft, bottomRight);
            }
        }

        // Calculate normals
        this.calculateNormals(vertices, indices, normals);

        return { vertices, indices, uvs, normals };
    }

    createExtrude(detail, depthScale) {
        const vertices = [];
        const indices = [];
        const uvs = [];
        const normals = [];
        const data = this.currentImageData;
        const width = data.width;
        const height = data.height;

        // Detect edges using brightness threshold
        const edgeMap = new Array(detail * detail).fill(false);
        let threshold = 0.3;

        for (let y = 0; y < detail; y++) {
            for (let x = 0; x < detail; x++) {
                const u = x / (detail - 1);
                const v = y / (detail - 1);
                const imgX = Math.floor(u * (width - 1));
                const imgY = Math.floor(v * (height - 1));
                const idx = (imgY * width + imgX) * 4;
                const brightness = (data.data[idx] + data.data[idx + 1] + data.data[idx + 2]) / (3 * 255);

                if (brightness > threshold) {
                    edgeMap[y * detail + x] = true;
                }
            }
        }

        // Create extruded geometry
        const baseVertices = [];
        for (let y = 0; y < detail; y++) {
            for (let x = 0; x < detail; x++) {
                if (edgeMap[y * detail + x]) {
                    const u = x / (detail - 1);
                    const v = y / (detail - 1);
                    const px = (u - 0.5) * 2;
                    const pz = (v - 0.5) * 2;

                    // Front face
                    baseVertices.push({ x: px, y: depthScale * 0.3, z: pz, u, v });
                    // Back face
                    baseVertices.push({ x: px, y: -depthScale * 0.3, z: pz, u, v });
                }
            }
        }

        // Simple plane with texture
        for (let i = 0; i < baseVertices.length; i += 2) {
            const v1 = baseVertices[i];
            vertices.push(v1.x, v1.y, v1.z);
            uvs.push(v1.u, 1 - v1.v);
            normals.push(0, 1, 0);
        }

        // Create indices (simple grid)
        for (let i = 0; i < vertices.length / 3 - 1; i++) {
            if (i % 2 === 0 && i < vertices.length / 3 - 2) {
                indices.push(i, i + 1, i + 2);
            }
        }

        return { vertices, indices, uvs, normals };
    }

    createSphere(detail) {
        const vertices = [];
        const indices = [];
        const uvs = [];
        const normals = [];
        const radius = 1;

        for (let lat = 0; lat <= detail; lat++) {
            const theta = (lat * Math.PI) / detail;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);

            for (let lon = 0; lon <= detail; lon++) {
                const phi = (lon * 2 * Math.PI) / detail;
                const sinPhi = Math.sin(phi);
                const cosPhi = Math.cos(phi);

                const x = cosPhi * sinTheta;
                const y = cosTheta;
                const z = sinPhi * sinTheta;

                const u = 1 - (lon / detail);
                const v = 1 - (lat / detail);

                vertices.push(radius * x, radius * y, radius * z);
                normals.push(x, y, z);
                uvs.push(u, v);
            }
        }

        for (let lat = 0; lat < detail; lat++) {
            for (let lon = 0; lon < detail; lon++) {
                const first = lat * (detail + 1) + lon;
                const second = first + detail + 1;

                indices.push(first, second, first + 1);
                indices.push(second, second + 1, first + 1);
            }
        }

        return { vertices, indices, uvs, normals };
    }

    createCube() {
        const vertices = [
            // Front face
            -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
            // Back face
            -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1,
            // Top face
            -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1,
            // Bottom face
            -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1,
            // Right face
            1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1,
            // Left face
            -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1
        ];

        const uvs = [
            // Front, Back, Top, Bottom, Right, Left
            0, 0, 1, 0, 1, 1, 0, 1,
            1, 0, 1, 1, 0, 1, 0, 0,
            0, 1, 0, 0, 1, 0, 1, 1,
            1, 1, 0, 1, 0, 0, 1, 0,
            1, 0, 1, 1, 0, 1, 0, 0,
            0, 0, 1, 0, 1, 1, 0, 1
        ];

        const normals = [
            0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
            0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
            0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
            0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
            1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
            -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0
        ];

        const indices = [
            0, 1, 2, 0, 2, 3,
            4, 5, 6, 4, 6, 7,
            8, 9, 10, 8, 10, 11,
            12, 13, 14, 12, 14, 15,
            16, 17, 18, 16, 18, 19,
            20, 21, 22, 20, 22, 23
        ];

        return { vertices, indices, uvs, normals };
    }

    calculateNormals(vertices, indices, normals) {
        // Initialize normals to zero
        for (let i = 0; i < vertices.length; i++) {
            normals.push(0);
        }

        // Calculate face normals and accumulate
        for (let i = 0; i < indices.length; i += 3) {
            const i1 = indices[i] * 3;
            const i2 = indices[i + 1] * 3;
            const i3 = indices[i + 2] * 3;

            const v1 = [vertices[i1], vertices[i1 + 1], vertices[i1 + 2]];
            const v2 = [vertices[i2], vertices[i2 + 1], vertices[i2 + 2]];
            const v3 = [vertices[i3], vertices[i3 + 1], vertices[i3 + 2]];

            const e1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
            const e2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];

            const normal = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0]
            ];

            for (let j = 0; j < 3; j++) {
                normals[i1 + j] += normal[j];
                normals[i2 + j] += normal[j];
                normals[i3 + j] += normal[j];
            }
        }

        // Normalize
        for (let i = 0; i < normals.length; i += 3) {
            const len = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2);
            if (len > 0) {
                normals[i] /= len;
                normals[i + 1] /= len;
                normals[i + 2] /= len;
            }
        }
    }

    createTextureFromImage() {
        const canvas = document.createElement('canvas');
        canvas.width = this.currentImageData.width;
        canvas.height = this.currentImageData.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(this.currentImageData, 0, 0);
        return canvas;
    }

    initWebGL() {
        this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
        if (!this.gl) {
            alert('WebGL not supported');
            return;
        }

        const gl = this.gl;

        // Vertex shader
        const vsSource = `
            attribute vec3 aPosition;
            attribute vec3 aNormal;
            attribute vec2 aTexCoord;

            uniform mat4 uModelViewMatrix;
            uniform mat4 uProjectionMatrix;
            uniform mat4 uNormalMatrix;

            varying vec2 vTexCoord;
            varying vec3 vNormal;
            varying vec3 vPosition;

            void main() {
                gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
                vTexCoord = aTexCoord;
                vNormal = normalize((uNormalMatrix * vec4(aNormal, 0.0)).xyz);
                vPosition = (uModelViewMatrix * vec4(aPosition, 1.0)).xyz;
            }
        `;

        // Fragment shader
        const fsSource = `
            precision mediump float;

            varying vec2 vTexCoord;
            varying vec3 vNormal;
            varying vec3 vPosition;

            uniform sampler2D uSampler;
            uniform vec3 uLightDirection;

            void main() {
                vec4 texColor = texture2D(uSampler, vTexCoord);

                vec3 normal = normalize(vNormal);
                vec3 lightDir = normalize(uLightDirection);

                float diffuse = max(dot(normal, lightDir), 0.0);
                float ambient = 0.3;

                vec3 lighting = vec3(ambient + diffuse * 0.7);

                gl_FragColor = vec4(texColor.rgb * lighting, texColor.a);
            }
        `;

        // Compile shaders
        const vertexShader = this.compileShader(gl, vsSource, gl.VERTEX_SHADER);
        const fragmentShader = this.compileShader(gl, fsSource, gl.FRAGMENT_SHADER);

        // Create program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Program link failed:', gl.getProgramInfoLog(this.program));
            return;
        }

        // Get attribute and uniform locations
        this.programInfo = {
            attribLocations: {
                position: gl.getAttribLocation(this.program, 'aPosition'),
                normal: gl.getAttribLocation(this.program, 'aNormal'),
                texCoord: gl.getAttribLocation(this.program, 'aTexCoord')
            },
            uniformLocations: {
                projectionMatrix: gl.getUniformLocation(this.program, 'uProjectionMatrix'),
                modelViewMatrix: gl.getUniformLocation(this.program, 'uModelViewMatrix'),
                normalMatrix: gl.getUniformLocation(this.program, 'uNormalMatrix'),
                sampler: gl.getUniformLocation(this.program, 'uSampler'),
                lightDirection: gl.getUniformLocation(this.program, 'uLightDirection')
            }
        };

        // Create buffers
        this.buffers = this.createBuffers();

        // Create texture
        this.texture = this.createTexture(this.currentModel.texture);

        // Enable depth test
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
    }

    compileShader(gl, source, type) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile failed:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

    createBuffers() {
        const gl = this.gl;
        const model = this.currentModel;

        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(model.vertices), gl.STATIC_DRAW);

        const normalBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(model.normals), gl.STATIC_DRAW);

        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(model.uvs), gl.STATIC_DRAW);

        const indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(model.indices), gl.STATIC_DRAW);

        return {
            position: positionBuffer,
            normal: normalBuffer,
            texCoord: texCoordBuffer,
            indices: indexBuffer
        };
    }

    createTexture(canvas) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return texture;
    }

    startRendering() {
        const render = () => {
            this.render();
            this.animationFrame = requestAnimationFrame(render);
        };
        render();
    }

    render() {
        const gl = this.gl;
        if (!gl || !this.currentModel) return;

        // Smooth camera
        this.camera.rotationX += (this.camera.targetRotationX - this.camera.rotationX) * 0.1;
        this.camera.rotationY += (this.camera.targetRotationY - this.camera.rotationY) * 0.1;
        this.camera.distance += (this.camera.targetDistance - this.camera.distance) * 0.1;

        // Resize canvas
        const displayWidth = this.canvas.clientWidth;
        const displayHeight = this.canvas.clientHeight;
        if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
            this.canvas.width = displayWidth;
            this.canvas.height = displayHeight;
            gl.viewport(0, 0, displayWidth, displayHeight);
        }

        gl.clearColor(0.1, 0.1, 0.18, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Projection matrix
        const fieldOfView = (45 * Math.PI) / 180;
        const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        const zNear = 0.1;
        const zFar = 100.0;
        const projectionMatrix = this.perspectiveMatrix(fieldOfView, aspect, zNear, zFar);

        // Model view matrix
        const modelViewMatrix = this.identityMatrix();
        this.translateMatrix(modelViewMatrix, 0, 0, -this.camera.distance);
        this.rotateMatrix(modelViewMatrix, this.camera.rotationX, 1, 0, 0);
        this.rotateMatrix(modelViewMatrix, this.camera.rotationY, 0, 1, 0);

        // Normal matrix
        const normalMatrix = this.invertMatrix(modelViewMatrix);
        this.transposeMatrix(normalMatrix);

        // Use program
        gl.useProgram(this.program);

        // Bind buffers and set attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.vertexAttribPointer(this.programInfo.attribLocations.position, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.programInfo.attribLocations.position);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.normal);
        gl.vertexAttribPointer(this.programInfo.attribLocations.normal, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.programInfo.attribLocations.normal);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.vertexAttribPointer(this.programInfo.attribLocations.texCoord, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.programInfo.attribLocations.texCoord);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.indices);

        // Set uniforms
        gl.uniformMatrix4fv(this.programInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
        gl.uniformMatrix4fv(this.programInfo.uniformLocations.modelViewMatrix, false, modelViewMatrix);
        gl.uniformMatrix4fv(this.programInfo.uniformLocations.normalMatrix, false, normalMatrix);
        gl.uniform3fv(this.programInfo.uniformLocations.lightDirection, [0.5, 1.0, 0.5]);

        // Bind texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(this.programInfo.uniformLocations.sampler, 0);

        // Draw
        gl.drawElements(gl.TRIANGLES, this.currentModel.indices.length, gl.UNSIGNED_SHORT, 0);
    }

    // Matrix operations
    identityMatrix() {
        return [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ];
    }

    perspectiveMatrix(fov, aspect, near, far) {
        const f = 1.0 / Math.tan(fov / 2);
        const rangeInv = 1 / (near - far);

        return [
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (near + far) * rangeInv, -1,
            0, 0, near * far * rangeInv * 2, 0
        ];
    }

    translateMatrix(m, x, y, z) {
        m[12] += m[0] * x + m[4] * y + m[8] * z;
        m[13] += m[1] * x + m[5] * y + m[9] * z;
        m[14] += m[2] * x + m[6] * y + m[10] * z;
        m[15] += m[3] * x + m[7] * y + m[11] * z;
    }

    rotateMatrix(m, angle, x, y, z) {
        const len = Math.sqrt(x * x + y * y + z * z);
        if (len === 0) return;

        x /= len;
        y /= len;
        z /= len;

        const s = Math.sin(angle);
        const c = Math.cos(angle);
        const t = 1 - c;

        const b00 = x * x * t + c;
        const b01 = y * x * t + z * s;
        const b02 = z * x * t - y * s;
        const b10 = x * y * t - z * s;
        const b11 = y * y * t + c;
        const b12 = z * y * t + x * s;
        const b20 = x * z * t + y * s;
        const b21 = y * z * t - x * s;
        const b22 = z * z * t + c;

        const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
        const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
        const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];

        m[0] = a00 * b00 + a10 * b01 + a20 * b02;
        m[1] = a01 * b00 + a11 * b01 + a21 * b02;
        m[2] = a02 * b00 + a12 * b01 + a22 * b02;
        m[3] = a03 * b00 + a13 * b01 + a23 * b02;
        m[4] = a00 * b10 + a10 * b11 + a20 * b12;
        m[5] = a01 * b10 + a11 * b11 + a21 * b12;
        m[6] = a02 * b10 + a12 * b11 + a22 * b12;
        m[7] = a03 * b10 + a13 * b11 + a23 * b12;
        m[8] = a00 * b20 + a10 * b21 + a20 * b22;
        m[9] = a01 * b20 + a11 * b21 + a21 * b22;
        m[10] = a02 * b20 + a12 * b21 + a22 * b22;
        m[11] = a03 * b20 + a13 * b21 + a23 * b22;
    }

    invertMatrix(m) {
        const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
        const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
        const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
        const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;

        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

        if (!det) return m;
        det = 1.0 / det;

        return [
            (a11 * b11 - a12 * b10 + a13 * b09) * det,
            (a02 * b10 - a01 * b11 - a03 * b09) * det,
            (a31 * b05 - a32 * b04 + a33 * b03) * det,
            (a22 * b04 - a21 * b05 - a23 * b03) * det,
            (a12 * b08 - a10 * b11 - a13 * b07) * det,
            (a00 * b11 - a02 * b08 + a03 * b07) * det,
            (a32 * b02 - a30 * b05 - a33 * b01) * det,
            (a20 * b05 - a22 * b02 + a23 * b01) * det,
            (a10 * b10 - a11 * b08 + a13 * b06) * det,
            (a01 * b08 - a00 * b10 - a03 * b06) * det,
            (a30 * b04 - a31 * b02 + a33 * b00) * det,
            (a21 * b02 - a20 * b04 - a23 * b00) * det,
            (a11 * b07 - a10 * b09 - a12 * b06) * det,
            (a00 * b09 - a01 * b07 + a02 * b06) * det,
            (a31 * b01 - a30 * b03 - a32 * b00) * det,
            (a20 * b03 - a21 * b01 + a22 * b00) * det
        ];
    }

    transposeMatrix(m) {
        const a01 = m[1], a02 = m[2], a03 = m[3];
        const a12 = m[6], a13 = m[7];
        const a23 = m[11];

        m[1] = m[4];
        m[2] = m[8];
        m[3] = m[12];
        m[4] = a01;
        m[6] = m[9];
        m[7] = m[13];
        m[8] = a02;
        m[9] = a12;
        m[11] = m[14];
        m[12] = a03;
        m[13] = a13;
        m[14] = a23;
    }

    // Mouse controls
    onMouseDown(e) {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    }

    onMouseMove(e) {
        if (!this.isDragging) return;

        const deltaX = e.clientX - this.lastMouseX;
        const deltaY = e.clientY - this.lastMouseY;

        this.camera.targetRotationY += deltaX * 0.01;
        this.camera.targetRotationX += deltaY * 0.01;

        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    }

    onMouseUp() {
        this.isDragging = false;
    }

    onWheel(e) {
        e.preventDefault();
        this.camera.targetDistance += e.deltaY * 0.01;
        this.camera.targetDistance = Math.max(1, Math.min(10, this.camera.targetDistance));
    }

    // Touch controls
    onTouchStart(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            this.isDragging = true;
            this.lastMouseX = e.touches[0].clientX;
            this.lastMouseY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            this.lastPinchDistance = this.getPinchDistance(e.touches);
        }
    }

    onTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1 && this.isDragging) {
            const deltaX = e.touches[0].clientX - this.lastMouseX;
            const deltaY = e.touches[0].clientY - this.lastMouseY;

            this.camera.targetRotationY += deltaX * 0.01;
            this.camera.targetRotationX += deltaY * 0.01;

            this.lastMouseX = e.touches[0].clientX;
            this.lastMouseY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            const distance = this.getPinchDistance(e.touches);
            const delta = this.lastPinchDistance - distance;
            this.camera.targetDistance += delta * 0.01;
            this.camera.targetDistance = Math.max(1, Math.min(10, this.camera.targetDistance));
            this.lastPinchDistance = distance;
        }
    }

    onTouchEnd() {
        this.isDragging = false;
        this.lastPinchDistance = 0;
    }

    getPinchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    resetView() {
        this.camera.targetRotationX = -0.5;
        this.camera.targetRotationY = 0.3;
        this.camera.targetDistance = 3;
    }

    exportSTL() {
        if (!this.currentModel) return;

        const model = this.currentModel;
        let stl = 'solid model\n';

        for (let i = 0; i < model.indices.length; i += 3) {
            const i1 = model.indices[i] * 3;
            const i2 = model.indices[i + 1] * 3;
            const i3 = model.indices[i + 2] * 3;

            const v1 = [model.vertices[i1], model.vertices[i1 + 1], model.vertices[i1 + 2]];
            const v2 = [model.vertices[i2], model.vertices[i2 + 1], model.vertices[i2 + 2]];
            const v3 = [model.vertices[i3], model.vertices[i3 + 1], model.vertices[i3 + 2]];

            const n1 = [model.normals[i1], model.normals[i1 + 1], model.normals[i1 + 2]];

            stl += `  facet normal ${n1[0].toFixed(6)} ${n1[1].toFixed(6)} ${n1[2].toFixed(6)}\n`;
            stl += `    outer loop\n`;
            stl += `      vertex ${v1[0].toFixed(6)} ${v1[1].toFixed(6)} ${v1[2].toFixed(6)}\n`;
            stl += `      vertex ${v2[0].toFixed(6)} ${v2[1].toFixed(6)} ${v2[2].toFixed(6)}\n`;
            stl += `      vertex ${v3[0].toFixed(6)} ${v3[1].toFixed(6)} ${v3[2].toFixed(6)}\n`;
            stl += `    endloop\n`;
            stl += `  endfacet\n`;
        }

        stl += 'endsolid model\n';

        const blob = new Blob([stl], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `model_${Date.now()}.stl`;
        a.click();
        URL.revokeObjectURL(url);
    }

    newModel() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        this.uploadSection.style.display = 'block';
        this.viewerSection.style.display = 'none';
        this.modelOptions.style.display = 'none';
        this.currentImage = null;
        this.currentImageData = null;
        this.currentModel = null;
        this.imageInput.value = '';
    }

    saveModel() {
        const models = JSON.parse(localStorage.getItem('models') || '[]');

        const modelData = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            type: this.currentModel.type,
            detail: this.currentModel.detail,
            depth: this.currentModel.depth,
            thumbnail: this.currentModel.texture.toDataURL('image/jpeg', 0.5),
            imageData: this.currentModel.texture.toDataURL('image/jpeg', 0.8)
        };

        models.unshift(modelData);

        // Keep only last 20 models
        if (models.length > 20) {
            models.splice(20);
        }

        localStorage.setItem('models', JSON.stringify(models));
        this.loadGallery();
    }

    loadGallery() {
        const models = JSON.parse(localStorage.getItem('models') || '[]');
        this.galleryGrid.innerHTML = '';

        if (models.length === 0) {
            this.galleryGrid.innerHTML = '<div class="empty-gallery">No saved models yet. Create your first 3D model!</div>';
            return;
        }

        models.forEach(model => {
            const item = document.createElement('div');
            item.className = 'gallery-item';
            item.innerHTML = `
                <img src="${model.thumbnail}" alt="Model">
                <div class="gallery-item-overlay">${model.type} - ${new Date(model.timestamp).toLocaleDateString()}</div>
                <button class="gallery-item-delete">×</button>
            `;

            item.querySelector('img').addEventListener('click', () => {
                this.loadModelFromGallery(model);
            });

            item.querySelector('.gallery-item-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteModel(model.id);
            });

            this.galleryGrid.appendChild(item);
        });
    }

    loadModelFromGallery(modelData) {
        const img = new Image();
        img.onload = () => {
            this.currentImage = img;
            this.processImage(img);

            this.modelTypeSelect.value = modelData.type;
            this.detailLevel.value = modelData.detail;
            this.depthIntensity.value = modelData.depth;
            document.getElementById('detailValue').textContent = modelData.detail;
            document.getElementById('depthValue').textContent = modelData.depth;

            this.generateModel();
        };
        img.src = modelData.imageData;
    }

    deleteModel(id) {
        const models = JSON.parse(localStorage.getItem('models') || '[]');
        const filtered = models.filter(m => m.id !== id);
        localStorage.setItem('models', JSON.stringify(filtered));
        this.loadGallery();
    }
}

// Initialize app
const app = new ModelGenerator();
