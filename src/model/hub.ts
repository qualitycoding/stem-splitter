import type { StemName } from "../dsp/stems";

export type ModelName = "htdemucs" | "htdemucs_ft_drums" | "htdemucs_ft_bass" | "htdemucs_ft_other" | "htdemucs_ft_vocals";

export interface ModelInfo {
  readonly name: ModelName;
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * Pinned to a specific Hugging Face commit, not `main` (plan/DECISIONS.md
 * D-04/D-05; research/spikes/SP-1.md). Re-run research/spikes/sp1.py before
 * changing any of these, and research/spikes/sp2.py before changing how a
 * session is created from them (plan/DECISIONS.md D-12).
 */
export const MODELS: Record<ModelName, ModelInfo> = {
  htdemucs: {
    name: "htdemucs",
    url: "https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/d54ed9eb60e258ea82131c6ee14578628816456a/htdemucs_fp16weights.onnx",
    sha256: "d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a",
    bytes: 165_612_636,
  },
  htdemucs_ft_drums: {
    name: "htdemucs_ft_drums",
    url: "https://huggingface.co/StemSplitio/htdemucs-ft-drums-onnx/resolve/55f929d333054c69ae0e829b15e8f8826a39d6eb/htdemucs_ft_drums_fp16weights.onnx",
    sha256: "047764dff888cfb87da917013377d4ec7a134f7419cbe486d9c339aa17975ddd",
    bytes: 165_612_636,
  },
  htdemucs_ft_bass: {
    name: "htdemucs_ft_bass",
    url: "https://huggingface.co/StemSplitio/htdemucs-ft-bass-onnx/resolve/410457f134bf91cb3ecb74abf1a897882d26afa8/htdemucs_ft_bass_fp16weights.onnx",
    sha256: "b533037176b14b2df31c92a5d5b3d5660d0811b9b360d3db761964768b079961",
    bytes: 165_612_636,
  },
  htdemucs_ft_other: {
    name: "htdemucs_ft_other",
    url: "https://huggingface.co/StemSplitio/htdemucs-ft-other-onnx/resolve/db6d606b4a6ee0b34f3fb09a6be4d23b07811318/htdemucs_ft_other_fp16weights.onnx",
    sha256: "b739171a7057b3107bb0711c6222d4a619b41b13a8f04026431d30f32ad2bd71",
    bytes: 165_612_636,
  },
  htdemucs_ft_vocals: {
    name: "htdemucs_ft_vocals",
    url: "https://huggingface.co/StemSplitio/htdemucs-ft-vocals-onnx/resolve/2ef0d757d3e226d0da85fb8c71514f464fcabdd0/htdemucs_ft_vocals_fp16weights.onnx",
    sha256: "0cbe651f535415c9d26a7bb614f7d322dd5a080fa0298f2e50f478030a994dce",
    bytes: 165_612_636,
  },
};

/** D-03: default mode, one model producing all four stems. */
export const STANDARD_MODEL: ModelName = "htdemucs";

/** D-03: high-quality mode, one specialist per stem, loaded one at a time. */
export const HQ_SPECIALIST_MODELS: Record<StemName, ModelName> = {
  drums: "htdemucs_ft_drums",
  bass: "htdemucs_ft_bass",
  other: "htdemucs_ft_other",
  vocals: "htdemucs_ft_vocals",
};
