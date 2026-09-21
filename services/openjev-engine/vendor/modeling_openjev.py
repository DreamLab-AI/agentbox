"""openjev: a Qwen3.5 decoder used as an NLI cross-encoder, plus a latent + MLP head trained with soft BCE.

Architecture
------------
* `OpenJevCrossEncoder`: `Qwen3_5ForSequenceClassification` — the Qwen3.5 text backbone followed by a linear
  `score` head over the hidden state of the last non-pad token. Three labels in dleemiller order
  (0 = contradiction, 1 = entailment, 2 = neutral). Input is one string
  `"Premise: {premise}\\nHypothesis: {hypothesis}"` (template stored in `config.nli_template`), right-padded.
  The vision tower that ships with Qwen3.5 checkpoints is kept but unused for text. Loss for the NLI head:
  cross-entropy over the three classes.
* `LatentMLPHead`: a small MLP (d -> 512 -> 1, GELU, dropout 0.1) on top of the frozen cross-encoder latent
  (the pooled hidden state that feeds `score`), one scalar per (question, option) pair. Loss: soft BCE —
  `BCEWithLogits(logit, y*(1-eps) + (1-y)*eps)` with positives re-weighted by (1-p)/p, p = positive rate.
  At inference the option with the highest score wins (per-question argmax).

Usage
-----
    from modeling_openjev import OpenJevCrossEncoder, LatentMLPHead
    ce = OpenJevCrossEncoder("AlexWortega/openjev", subfolder="qwen3.5-4b-nli")
    ce.predict([("A man is playing a guitar.", "Someone is making music.")])   # -> [[p_con, p_ent, p_neu]]
    ce.rerank("What is the capital of France?", ["Paris", "Lyon", "Berlin"])   # -> index of the best option

    X = ce.latents(pairs)                       # (n_pairs, d) float32
    head = LatentMLPHead(X.shape[1]).fit(X, gold, qid)   # gold in {0,1} per pair, qid groups pairs by question
    head.predict(X)                             # (n_pairs,) logits; argmax within each qid
"""
from __future__ import annotations

import json
import os

import numpy as np
import torch
import torch.nn as nn

CON, ENT, NEU = 0, 1, 2
DEFAULT_TEMPLATE = "Premise: {premise}\nHypothesis: {hypothesis}"


class OpenJevCrossEncoder:
    def __init__(self, path: str, subfolder: str | None = None, device: str | None = None, dtype=torch.bfloat16,
                 bs: int = 32, max_len: int = 4096):
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        kw = {"subfolder": subfolder} if subfolder else {}
        self.tok = AutoTokenizer.from_pretrained(path, **kw)
        self.model = AutoModelForSequenceClassification.from_pretrained(path, dtype=dtype, **kw)
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device).eval()
        self.template = getattr(self.model.config, "nli_template", None) or DEFAULT_TEMPLATE
        if self.tok.pad_token is None:
            self.tok.pad_token = self.tok.eos_token
        self.tok.padding_side = "right"  # the head pools the last non-pad token
        tc = self.model.config.get_text_config()
        if tc.pad_token_id is None:
            tc.pad_token_id = self.tok.pad_token_id
        self.backbone = getattr(self.model, self.model.base_model_prefix)
        self.bs, self.max_len = bs, max_len

    def _encode(self, pairs):
        texts = [self.template.format(premise=p.strip(), hypothesis=h.strip()) for p, h in pairs]
        enc = self.tok(texts, truncation=True, max_length=self.max_len, padding=True, return_tensors="pt")
        return {k: v.to(self.device) for k, v in enc.items()}

    @torch.no_grad()
    def _pooled(self, enc):
        h = self.backbone(**enc).last_hidden_state
        last = enc["attention_mask"].sum(1) - 1
        return h[torch.arange(h.shape[0], device=h.device), last]

    @torch.no_grad()
    def latents(self, pairs) -> np.ndarray:
        """Pooled last-token hidden state (the input of the `score` head) for each (premise, hypothesis) pair."""
        out = []
        for i in range(0, len(pairs), self.bs):
            out.append(self._pooled(self._encode(pairs[i:i + self.bs])).float().cpu().numpy())
        return np.concatenate(out, 0)

    @torch.no_grad()
    def predict(self, pairs) -> np.ndarray:
        """Softmax probabilities [contradiction, entailment, neutral] per pair."""
        out = []
        for i in range(0, len(pairs), self.bs):
            logits = self.model.score(self._pooled(self._encode(pairs[i:i + self.bs]))).float()
            out.append(torch.softmax(logits, -1).cpu().numpy())
        return np.concatenate(out, 0)

    @torch.no_grad()
    def _pooled_hypotheses(self, premise: str, hypotheses) -> torch.Tensor:
        """Score hypotheses with one shared text prefix and a batched cached continuation.

        Qwen3.5 mixes full and recurrent linear attention. A packed 4D tree mask
        cannot isolate the recurrent layers, so their state and the full-attention
        KV cache are branched into the batch after a single prefix prefill.
        """
        hypotheses = list(hypotheses)
        if not hypotheses:
            raise ValueError("hypotheses must not be empty")
        pairs = [(premise, h) for h in hypotheses]
        # A second forward and cache branching are unlikely to pay off for
        # one or two hypotheses; use the existing batched path instead.
        if len(pairs) < 3:
            return self._pooled(self._encode(pairs))

        # Tokenize complete inputs first: a tokenizer can merge characters at
        # the premise/hypothesis boundary, so a textual split is not reliable.
        texts = [self.template.format(premise=p.strip(), hypothesis=h.strip()) for p, h in pairs]
        sequences = [self.tok(t, truncation=True, max_length=self.max_len)["input_ids"] for t in texts]
        common = 0
        for column in zip(*sequences):
            if len(set(column)) != 1:
                break
            common += 1
        common = min(common, min(map(len, sequences)) - 1)
        if common < 1:
            return self._pooled(self._encode(pairs))

        prefix = torch.tensor([sequences[0][:common]], device=self.device)
        prefix_positions = torch.arange(common, device=self.device).unsqueeze(0)
        cache = self.backbone(input_ids=prefix, position_ids=prefix_positions, use_cache=True).past_key_values
        if cache is None:
            raise RuntimeError("Qwen3.5 did not return a cache for shared-prefix inference")
        cache.reorder_cache(torch.zeros(len(sequences), dtype=torch.long, device=self.device))

        suffixes = [s[common:] for s in sequences]
        lengths = torch.tensor([len(s) for s in suffixes], device=self.device)
        width = int(lengths.max())
        input_ids = torch.full((len(suffixes), width), self.tok.pad_token_id,
                               dtype=torch.long, device=self.device)
        for row, suffix in enumerate(suffixes):
            input_ids[row, :len(suffix)] = torch.tensor(suffix, device=self.device)
        offsets = torch.arange(width, device=self.device).unsqueeze(0)
        valid = offsets < lengths.unsqueeze(1)
        attention_mask = torch.cat((torch.ones((len(suffixes), common), device=self.device,
                                               dtype=torch.long), valid.long()), dim=1)
        position_ids = (common + offsets).expand(len(suffixes), -1)
        hidden = self.backbone(input_ids=input_ids, attention_mask=attention_mask,
                               position_ids=position_ids, past_key_values=cache,
                               use_cache=True).last_hidden_state
        return hidden[torch.arange(len(suffixes), device=self.device), lengths - 1]

    @torch.no_grad()
    def latents_hypotheses(self, premise: str, hypotheses) -> np.ndarray:
        """Pooled last-token latents for hypotheses sharing one premise."""
        return self._pooled_hypotheses(premise, hypotheses).float().cpu().numpy()

    @torch.no_grad()
    def predict_hypotheses(self, premise: str, hypotheses) -> np.ndarray:
        """NLI probabilities for one premise and many hypotheses, sharing the prefix."""
        return torch.softmax(self.model.score(self._pooled_hypotheses(premise, hypotheses)).float(), -1).cpu().numpy()

    def rerank(self, question: str, options, hyp_fmt: str = "The correct answer is: {}") -> int:
        """Zero-shot multiple choice: option with the highest P(entailment) given the question as premise."""
        p = self.predict_hypotheses(question, [hyp_fmt.format(o) for o in options])
        return int(p[:, ENT].argmax())

    def grade(self, question: str, reference: str, candidate: str) -> str:
        """Reference-based grading: premise = question + reference, hypothesis = candidate."""
        p = self.predict([(f"{question}\nReference answer: {reference}", f"Answer: {candidate}")])[0]
        return ["contradiction", "entailment", "neutral"][int(p.argmax())]


class _MLP(nn.Module):
    def __init__(self, d, hidden=512, p=0.1):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(d, hidden), nn.GELU(), nn.Dropout(p), nn.Linear(hidden, 1))

    def forward(self, x):
        return self.net(x).squeeze(-1)


def soft_bce(logits, y, eps, pos_weight):
    """BCE with soft targets: gold -> 1-eps, others -> eps; positives up-weighted by pos_weight."""
    target = y * (1 - eps) + (1 - y) * eps
    w = torch.where(y > 0.5, pos_weight, torch.ones_like(y))
    return (w * nn.functional.binary_cross_entropy_with_logits(logits, target, reduction="none")).mean()


def per_question_acc(scores, qid, gold):
    """Fraction of questions whose argmax-scored option is the gold one."""
    order = np.argsort(qid, kind="stable")
    scores, qid, gold = scores[order], qid[order], gold[order]
    starts = np.r_[0, np.flatnonzero(np.diff(qid)) + 1, len(qid)]
    hits = [gold[a:b][scores[a:b].argmax()] == 1 for a, b in zip(starts[:-1], starts[1:])]
    return float(np.mean(hits))


def grouped_split(qid, frac, seed):
    qs = np.unique(qid)
    rng = np.random.RandomState(seed)
    rng.shuffle(qs)
    hold = set(qs[: max(1, int(len(qs) * frac))].tolist())
    mask = np.array([q in hold for q in qid])
    return ~mask, mask


class LatentMLPHead:
    def __init__(self, d: int, hidden: int = 512, dropout: float = 0.1, eps: float = 0.1, lr: float = 1e-3,
                 wd: float = 1e-2, bs: int = 512, epochs: int = 60, patience: int = 8, seed: int = 0, device: str | None = None):
        self.cfg = dict(d=d, hidden=hidden, dropout=dropout, eps=eps, lr=lr, wd=wd, bs=bs, epochs=epochs, patience=patience, seed=seed)
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        torch.manual_seed(seed)
        self.model = _MLP(d, hidden, dropout).to(self.device)
        self.mu, self.sd = np.zeros((1, d), np.float32), np.ones((1, d), np.float32)

    def _t(self, X):
        return torch.tensor((X - self.mu) / self.sd, dtype=torch.float32, device=self.device)

    def fit(self, X, gold, qid, val_frac: float = 0.1):
        """X: (n_pairs, d); gold: 1 for the correct option of a question, 0 otherwise; qid: question id per pair.
        Early stopping on per-question accuracy of a grouped hold-out; restores the best weights."""
        X, gold, qid = np.asarray(X, np.float32), np.asarray(gold, np.float32), np.asarray(qid)
        tr, va = grouped_split(qid, val_frac, self.cfg["seed"])
        self.mu, self.sd = X[tr].mean(0, keepdims=True), X[tr].std(0, keepdims=True) + 1e-6
        Xtr, ytr, Xva = self._t(X[tr]), torch.tensor(gold[tr], device=self.device), self._t(X[va])
        p = float(gold[tr].mean())
        pos_weight = torch.tensor((1 - p) / max(p, 1e-6), device=self.device)
        opt = torch.optim.AdamW(self.model.parameters(), lr=self.cfg["lr"], weight_decay=self.cfg["wd"])
        best, best_state, bad = -1.0, None, 0
        for ep in range(self.cfg["epochs"]):
            self.model.train()
            perm = torch.randperm(len(Xtr), device=self.device)
            for s in range(0, len(Xtr), self.cfg["bs"]):
                idx = perm[s:s + self.cfg["bs"]]
                loss = soft_bce(self.model(Xtr[idx]), ytr[idx], self.cfg["eps"], pos_weight)
                opt.zero_grad(); loss.backward(); opt.step()
            self.model.eval()
            with torch.no_grad():
                acc = per_question_acc(self.model(Xva).cpu().numpy(), qid[va], gold[va])
            if acc > best:
                best, bad, best_state = acc, 0, {k: v.clone() for k, v in self.model.state_dict().items()}
            else:
                bad += 1
                if bad >= self.cfg["patience"]:
                    break
        self.model.load_state_dict(best_state)
        self.model.eval()
        self.val_acc = best
        return self

    @torch.no_grad()
    def predict(self, X) -> np.ndarray:
        """One logit per pair; pick the argmax within each question (sigmoid gives a per-option probability)."""
        self.model.eval()
        return self.model(self._t(np.asarray(X, np.float32))).cpu().numpy()

    def save(self, path: str):
        os.makedirs(path, exist_ok=True)
        torch.save(self.model.state_dict(), os.path.join(path, "head.pt"))
        np.savez(os.path.join(path, "norm.npz"), mu=self.mu, sd=self.sd)
        json.dump(self.cfg, open(os.path.join(path, "config.json"), "w"), indent=2)

    @classmethod
    def load(cls, path: str, device: str | None = None) -> "LatentMLPHead":
        cfg = json.load(open(os.path.join(path, "config.json")))
        head = cls(device=device, **cfg)
        head.model.load_state_dict(torch.load(os.path.join(path, "head.pt"), map_location=head.device))
        z = np.load(os.path.join(path, "norm.npz"))
        head.mu, head.sd = z["mu"], z["sd"]
        head.model.eval()
        return head
