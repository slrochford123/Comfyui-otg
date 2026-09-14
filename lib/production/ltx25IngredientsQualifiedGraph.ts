/*
 * OTG_LTX25_INGREDIENTS_QUALIFIED_GRAPH_V1
 *
 * Exact Comfy API graph captured from the successful
 * RTX 5060 Ti and RTX 3090 LTX 2.5 Ingredients qualification.
 *
 * Do not edit node topology or fixed model/sampling values casually.
 * Runtime fields are overridden by ltx25IngredientsWorkflow.ts.
 */
export const LTX25_INGREDIENTS_QUALIFIED_GRAPH_V1 = {
  "1": {
    "class_type": "LoadImage",
    "inputs": {
      "image": "otg_ltx25_ingredients_qual_ref_3090.png"
    }
  },
  "2": {
    "class_type": "VAELoader",
    "inputs": {
      "vae_name": "ltx-2.5-audio-vae-bf16.safetensors"
    }
  },
  "3": {
    "class_type": "VAELoader",
    "inputs": {
      "vae_name": "ltx-2.5-video-vae-bf16.safetensors"
    }
  },
  "4": {
    "class_type": "UNETLoader",
    "inputs": {
      "unet_name": "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
      "weight_dtype": "default"
    }
  },
  "5": {
    "class_type": "CLIPLoader",
    "inputs": {
      "clip_name": "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
      "type": "ltxv",
      "device": "default"
    }
  },
  "6": {
    "class_type": "LTXICLoRALoaderModelOnly",
    "inputs": {
      "model": [
        "4",
        0
      ],
      "lora_name": "LTX-2.x/Control-and-Editing/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
      "strength_model": 1.3
    }
  },
  "7": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "Using the reference sheet as identity guidance, the bright red toy robot shown on the LEFT side walks across a clean studio floor toward the blue hard-shell suitcase shown on the RIGHT side. The robot stops beside the suitcase and turns its head toward it. Preserve the robot's bright red body, gray joints and face design. Preserve the suitcase's blue shell, vertical ridges and dark handle. Medium-wide static camera, neutral studio background, realistic smooth motion, consistent object identity throughout the entire clip. Soft mechanical footsteps and subtle room ambience.",
      "clip": [
        "5",
        0
      ]
    }
  },
  "8": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "duplicate robot, duplicate suitcase, extra limbs, deformed geometry, identity changes, object color changes, flicker, jump cuts, camera cuts, text, logo, watermark",
      "clip": [
        "5",
        0
      ]
    }
  },
  "9": {
    "class_type": "LTXVConditioning",
    "inputs": {
      "positive": [
        "7",
        0
      ],
      "negative": [
        "8",
        0
      ],
      "frame_rate": 24
    }
  },
  "10": {
    "class_type": "EmptyLTXVLatentVideo",
    "inputs": {
      "width": 960,
      "height": 544,
      "length": 121,
      "batch_size": 1
    }
  },
  "11": {
    "class_type": "RepeatImageBatch",
    "inputs": {
      "image": [
        "1",
        0
      ],
      "amount": 121
    }
  },
  "12": {
    "class_type": "LTXAddVideoICLoRAGuide",
    "inputs": {
      "positive": [
        "9",
        0
      ],
      "negative": [
        "9",
        1
      ],
      "vae": [
        "3",
        0
      ],
      "latent": [
        "10",
        0
      ],
      "image": [
        "11",
        0
      ],
      "frame_idx": 0,
      "strength": 1.0,
      "latent_downscale_factor": [
        "6",
        1
      ],
      "crop": "disabled",
      "use_tiled_encode": false,
      "tile_size": 256,
      "tile_overlap": 64
    }
  },
  "13": {
    "class_type": "LTXVEmptyLatentAudio",
    "inputs": {
      "frames_number": 121,
      "frame_rate": 24,
      "batch_size": 1,
      "audio_vae": [
        "2",
        0
      ]
    }
  },
  "14": {
    "class_type": "LTXVConcatAVLatent",
    "inputs": {
      "video_latent": [
        "12",
        2
      ],
      "audio_latent": [
        "13",
        0
      ]
    }
  },
  "15": {
    "class_type": "CFGGuider",
    "inputs": {
      "model": [
        "6",
        0
      ],
      "positive": [
        "12",
        0
      ],
      "negative": [
        "12",
        1
      ],
      "cfg": 1.0
    }
  },
  "16": {
    "class_type": "KSamplerSelect",
    "inputs": {
      "sampler_name": "euler_ancestral_cfg_pp"
    }
  },
  "17": {
    "class_type": "ManualSigmas",
    "inputs": {
      "sigmas": "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0"
    }
  },
  "18": {
    "class_type": "RandomNoise",
    "inputs": {
      "noise_seed": 42
    }
  },
  "19": {
    "class_type": "SamplerCustomAdvanced",
    "inputs": {
      "noise": [
        "18",
        0
      ],
      "guider": [
        "15",
        0
      ],
      "sampler": [
        "16",
        0
      ],
      "sigmas": [
        "17",
        0
      ],
      "latent_image": [
        "14",
        0
      ]
    }
  },
  "20": {
    "class_type": "LTXVSeparateAVLatent",
    "inputs": {
      "av_latent": [
        "19",
        0
      ]
    }
  },
  "21": {
    "class_type": "LTXVCropGuides",
    "inputs": {
      "positive": [
        "12",
        0
      ],
      "negative": [
        "12",
        1
      ],
      "latent": [
        "20",
        0
      ]
    }
  },
  "22": {
    "class_type": "VAEDecodeTiled",
    "inputs": {
      "samples": [
        "21",
        2
      ],
      "vae": [
        "3",
        0
      ],
      "tile_size": 512,
      "overlap": 64,
      "temporal_size": 128,
      "temporal_overlap": 32
    }
  },
  "23": {
    "class_type": "LTXVAudioVAEDecode",
    "inputs": {
      "samples": [
        "20",
        1
      ],
      "audio_vae": [
        "2",
        0
      ]
    }
  },
  "24": {
    "class_type": "CreateVideo",
    "inputs": {
      "images": [
        "22",
        0
      ],
      "fps": 24,
      "audio": [
        "23",
        0
      ],
      "bit_depth": 8
    }
  },
  "25": {
    "class_type": "SaveVideo",
    "inputs": {
      "video": [
        "24",
        0
      ],
      "filename_prefix": "otg_ltx25_ingredients_qual_3090",
      "format": "auto",
      "codec": "auto"
    }
  }
} as const;
