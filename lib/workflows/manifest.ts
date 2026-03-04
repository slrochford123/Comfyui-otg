
export const WORKFLOWS = {
  angles: {
    file: "Angles.json",
    output: "image",
    destination: "gallery",
    patch: { imageNode: 41, angleNode: 93 }
  },

  storyboard_1: { file: "Storyboard 1.json", images: 1, promptNode: 30, output: "image", destination: "gallery" },
  storyboard_2: { file: "Storyboard 2.json", images: 2, promptNode: 30, output: "image", destination: "gallery" },
  storyboard_3: { file: "Storyboard 3.json", images: 3, promptNode: 30, output: "image", destination: "gallery" },
  storyboard_4: { file: "Storyboard 4.json", images: 4, promptNode: 30, output: "image", destination: "gallery" },
  storyboard_5: { file: "Storyboard 5.json", images: 5, promptNode: 30, output: "image", destination: "gallery" },

  voice_design: {
    file: "Voice Creation_.json",
    output: "audio",
    destination: "voice_library",
    patch: { textNode: 76, instructNode: 77 }
  },

  voice_clone: {
    file: "Voice Clone.json",
    output: "audio",
    destination: "voice_library"
  },

  group_voice: {
    file: "Group Voice.json",
    output: "audio",
    destination: "voice_library"
  }
};
