import * as THREE from "./three.module.js";

// Vanilla Three.js port of the MeshTransmissionMaterial implementation used by
// the reference site. Keeping the same shader path is important here: the
// colour separation is produced by per-channel refraction, not a CSS filter.
export class MeshTransmissionMaterial extends THREE.MeshPhysicalMaterial {
  constructor(samples = 4, transmissionSampler = false) {
    super();

    this.uniforms = {
      chromaticAberration: { value: 0.05 },
      transmission: { value: 0 },
      _transmission: { value: 1 },
      transmissionMap: { value: null },
      roughness: { value: 0 },
      thickness: { value: 0 },
      thicknessMap: { value: null },
      attenuationDistance: { value: Infinity },
      attenuationColor: { value: new THREE.Color("white") },
      anisotropicBlur: { value: 0.1 },
      time: { value: 0 },
      distortion: { value: 0 },
      distortionScale: { value: 0.5 },
      temporalDistortion: { value: 0 },
      buffer: { value: null },
    };

    this.onBeforeCompile = (shader) => {
      shader.uniforms = { ...shader.uniforms, ...this.uniforms };

      if ((this.anisotropy || 0) > 0) shader.defines.USE_ANISOTROPY = "";
      if (transmissionSampler) shader.defines.USE_SAMPLER = "";
      else shader.defines.USE_TRANSMISSION = "";

      shader.fragmentShader = `
        uniform float chromaticAberration;
        uniform float anisotropicBlur;
        uniform float time;
        uniform float distortion;
        uniform float distortionScale;
        uniform float temporalDistortion;
        uniform sampler2D buffer;

        vec3 random3(vec3 c) {
          float j = 4096.0 * sin(dot(c, vec3(17.0, 59.4, 15.0)));
          vec3 r;
          r.z = fract(512.0 * j);
          j *= .125;
          r.x = fract(512.0 * j);
          j *= .125;
          r.y = fract(512.0 * j);
          return r - 0.5;
        }

        uint hash(uint x) {
          x += (x << 10u);
          x ^= (x >> 6u);
          x += (x << 3u);
          x ^= (x >> 11u);
          x += (x << 15u);
          return x;
        }
        uint hash(uvec2 v) { return hash(v.x ^ hash(v.y)); }
        uint hash(uvec3 v) { return hash(v.x ^ hash(v.y) ^ hash(v.z)); }
        uint hash(uvec4 v) { return hash(v.x ^ hash(v.y) ^ hash(v.z) ^ hash(v.w)); }

        float floatConstruct(uint m) {
          const uint ieeeMantissa = 0x007FFFFFu;
          const uint ieeeOne = 0x3F800000u;
          m &= ieeeMantissa;
          m |= ieeeOne;
          return uintBitsToFloat(m) - 1.0;
        }
        float randomBase(float x) { return floatConstruct(hash(floatBitsToUint(x))); }
        float randomBase(vec2 v) { return floatConstruct(hash(floatBitsToUint(v))); }
        float randomBase(vec3 v) { return floatConstruct(hash(floatBitsToUint(v))); }
        float randomBase(vec4 v) { return floatConstruct(hash(floatBitsToUint(v))); }
        float rand(float seed) { return randomBase(vec3(gl_FragCoord.xy, seed)); }

        const float F3 = 0.3333333;
        const float G3 = 0.1666667;
        float snoise(vec3 p) {
          vec3 s = floor(p + dot(p, vec3(F3)));
          vec3 x = p - s + dot(s, vec3(G3));
          vec3 e = step(vec3(0.0), x - x.yzx);
          vec3 i1 = e * (1.0 - e.zxy);
          vec3 i2 = 1.0 - e.zxy * (1.0 - e);
          vec3 x1 = x - i1 + G3;
          vec3 x2 = x - i2 + 2.0 * G3;
          vec3 x3 = x - 1.0 + 3.0 * G3;
          vec4 w, d;
          w.x = dot(x, x);
          w.y = dot(x1, x1);
          w.z = dot(x2, x2);
          w.w = dot(x3, x3);
          w = max(0.6 - w, 0.0);
          d.x = dot(random3(s), x);
          d.y = dot(random3(s + i1), x1);
          d.z = dot(random3(s + i2), x2);
          d.w = dot(random3(s + 1.0), x3);
          w *= w;
          w *= w;
          d *= w;
          return dot(d, vec4(52.0));
        }
        float snoiseFractal(vec3 m) {
          return 0.5333333 * snoise(m)
            + 0.2666667 * snoise(2.0 * m)
            + 0.1333333 * snoise(4.0 * m)
            + 0.0666667 * snoise(8.0 * m);
        }
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <transmission_pars_fragment>",
        `
        #ifdef USE_TRANSMISSION
          uniform float _transmission;
          uniform float thickness;
          uniform float attenuationDistance;
          uniform vec3 attenuationColor;
          #ifdef USE_TRANSMISSIONMAP
            uniform sampler2D transmissionMap;
          #endif
          #ifdef USE_THICKNESSMAP
            uniform sampler2D thicknessMap;
          #endif
          uniform vec2 transmissionSamplerSize;
          uniform sampler2D transmissionSamplerMap;
          uniform mat4 modelMatrix;
          uniform mat4 projectionMatrix;
          varying vec3 vWorldPosition;

          vec3 getVolumeTransmissionRay(const in vec3 n, const in vec3 v, const in float thicknessValue, const in float ior, const in vec3 modelScale) {
            vec3 refractionVector = refract(-v, n, 1.0 / ior);
            return normalize(refractionVector) * thicknessValue * modelScale;
          }
          float applyIorToRoughness(const in float roughnessValue, const in float ior) {
            return roughnessValue * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
          }
          vec4 getTransmissionSample(const in vec2 fragCoord, const in float roughnessValue, const in float ior) {
            float framebufferLod = log2(transmissionSamplerSize.x) * applyIorToRoughness(roughnessValue, ior);
            #ifdef USE_SAMPLER
              #ifdef texture2DLodEXT
                return texture2DLodEXT(transmissionSamplerMap, fragCoord.xy, framebufferLod);
              #else
                return texture2D(transmissionSamplerMap, fragCoord.xy, framebufferLod);
              #endif
            #else
              return texture2D(buffer, fragCoord.xy);
            #endif
          }
          vec4 getIBLVolumeRefraction(
            const in vec3 n,
            const in vec3 v,
            const in float roughnessValue,
            const in vec3 diffuseColorValue,
            const in vec3 position,
            const in vec3 modelScale,
            const in vec3 attenuationCoefficient,
            const in vec3 F,
            const in mat4 viewMatrixValue,
            const in mat4 projMatrix,
            const in float ior,
            const in float thicknessValue,
            const in float attenuationDistanceValue
          ) {
            vec3 transmissionRay = getVolumeTransmissionRay(n, v, thicknessValue, ior, modelScale);
            vec3 refractedRayExit = position + transmissionRay;
            vec4 ndcPos = projMatrix * viewMatrixValue * vec4(refractedRayExit, 1.0);
            vec2 refractionCoords = ndcPos.xy / ndcPos.w;
            refractionCoords = (refractionCoords + 1.0) / 2.0;
            vec4 transmittedLight = getTransmissionSample(refractionCoords, roughnessValue, ior);
            vec3 attenuatedColor = transmittedLight.rgb;
            if (!isinf(attenuationDistanceValue)) {
              attenuatedColor *= exp(-attenuationCoefficient * length(transmissionRay));
            }
            return vec4((1.0 - F) * attenuatedColor * diffuseColorValue, transmittedLight.a);
          }
        #endif
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <transmission_fragment>",
        `
        material.transmission = _transmission;
        material.transmissionAlpha = 1.0;
        material.thickness = thickness;
        material.attenuationDistance = attenuationDistance;
        material.attenuationColor = attenuationColor;
        #ifdef USE_TRANSMISSIONMAP
          material.transmission *= texture2D(transmissionMap, vUv).r;
        #endif
        #ifdef USE_THICKNESSMAP
          material.thickness *= texture2D(thicknessMap, vUv).g;
        #endif

        if (material.transmission != 0.0) {
          vec3 pos = vWorldPosition;
          float runningSeed = 0.0;
          vec3 v = normalize(cameraPosition - pos);
          vec3 n = inverseTransformDirection(normal, viewMatrix);
          vec3 transmissionValue = vec3(0.0);
          float randomCoords = rand(runningSeed++);
          float thicknessSmear = thickness * max(pow(roughnessFactor, 0.33), anisotropicBlur);
          vec3 distortionNormal = vec3(0.0);
          vec3 temporalOffset = vec3(time, -time, -time) * temporalDistortion;
          vec3 modelScale = vec3(
            length(vec3(modelMatrix[0].xyz)),
            length(vec3(modelMatrix[1].xyz)),
            length(vec3(modelMatrix[2].xyz))
          );
          vec3 attenuationCoefficient = vec3(0.0);
          if (!isinf(material.attenuationDistance)) {
            attenuationCoefficient = -log(material.attenuationColor) / material.attenuationDistance;
          }
          if (distortion > 0.0) {
            distortionNormal = distortion * vec3(
              snoiseFractal(vec3(pos * distortionScale + temporalOffset)),
              snoiseFractal(vec3(pos.zxy * distortionScale - temporalOffset)),
              snoiseFractal(vec3(pos.yxz * distortionScale + temporalOffset))
            );
          }
          for (float i = 0.0; i < ${samples}.0; i++) {
            vec3 sampleNorm;
            if (roughnessFactor > 0.0) {
              sampleNorm = normalize(
                n + roughnessFactor * roughnessFactor * 2.0
                * normalize(vec3(rand(runningSeed++) - 0.5, rand(runningSeed++) - 0.5, rand(runningSeed++) - 0.5))
                * pow(rand(runningSeed++), 0.33) + distortionNormal
              );
            } else {
              sampleNorm = normalize(n + distortionNormal);
            }
            float sampleProgress = (i + randomCoords) / float(${samples});
            float sampleThickness = material.thickness + thicknessSmear * sampleProgress;
            vec3 F = EnvironmentBRDF(sampleNorm, v, material.specularColor, material.specularF90, material.roughness);
            if (chromaticAberration == 0.0) {
              transmissionValue += getIBLVolumeRefraction(
                sampleNorm, v, material.roughness, material.diffuseColor, pos, modelScale, attenuationCoefficient, F,
                viewMatrix, projectionMatrix, material.ior, sampleThickness, material.attenuationDistance
              ).rgb;
            } else {
              float aberration = chromaticAberration * sampleProgress;
              transmissionValue.r += getIBLVolumeRefraction(
                sampleNorm, v, material.roughness, material.diffuseColor, pos, modelScale, attenuationCoefficient, F,
                viewMatrix, projectionMatrix, material.ior, sampleThickness, material.attenuationDistance
              ).r;
              transmissionValue.g += getIBLVolumeRefraction(
                sampleNorm, v, material.roughness, material.diffuseColor, pos, modelScale, attenuationCoefficient, F,
                viewMatrix, projectionMatrix, material.ior * (1.0 + aberration), sampleThickness, material.attenuationDistance
              ).g;
              transmissionValue.b += getIBLVolumeRefraction(
                sampleNorm, v, material.roughness, material.diffuseColor, pos, modelScale, attenuationCoefficient, F,
                viewMatrix, projectionMatrix, material.ior * (1.0 + 2.0 * aberration), sampleThickness, material.attenuationDistance
              ).b;
            }
          }
          transmissionValue /= ${samples}.0;
          totalDiffuse = mix(totalDiffuse, transmissionValue, material.transmission);
        }
        `,
      );
    };

    Object.keys(this.uniforms).forEach((name) => {
      Object.defineProperty(this, name, {
        configurable: true,
        get: () => this.uniforms[name].value,
        set: (value) => {
          this.uniforms[name].value = value;
        },
      });
    });
  }
}
