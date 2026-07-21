// AUTOMATISCH GENERIERT von scripts/gen-templates (Provenienz im PROJEKTSTATUS).
// Kuratierte, allgemein bekannte Trainingspläne als Vorlagen. Übungen sind über
// dieselbe deterministische UUIDv5 wie der Import referenziert (Namespace
// ec5d9315-…), zeigen also auf existierende globale exercises-Zeilen.
// NICHT von Hand editieren — Katalog im Generator anpassen und neu erzeugen.

/** Eine Übung innerhalb einer Plan-Vorlage. */
export type PlanTemplateExercise = {
  exerciseId: string;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  restSeconds: number;
};

/** Kuratierte Trainingsplan-Vorlage (kein Nutzerbesitz, nicht synchronisiert). */
export type PlanTemplate = {
  slug: string;
  name: string;
  goal: string;
  exercises: PlanTemplateExercise[];
};

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    "slug": "fullbody-beginner",
    "name": "Ganzkörper für Einsteiger",
    "goal": "Muskelaufbau & Grundlagen · 3×/Woche",
    "exercises": [
      {
        "exerciseId": "37609db7-83e0-54f4-b006-eae02dcbb958",
        "targetSets": 3,
        "targetRepsMin": 8,
        "targetRepsMax": 12,
        "restSeconds": 120
      },
      {
        "exerciseId": "52b93346-35c6-5d9f-98c9-aee8761fa247",
        "targetSets": 3,
        "targetRepsMin": 8,
        "targetRepsMax": 12,
        "restSeconds": 120
      },
      {
        "exerciseId": "91f84555-62af-509e-ba6c-321a290717d9",
        "targetSets": 3,
        "targetRepsMin": 10,
        "targetRepsMax": 12,
        "restSeconds": 90
      },
      {
        "exerciseId": "2beaf071-2c8b-589b-8860-10b51132081b",
        "targetSets": 3,
        "targetRepsMin": 10,
        "targetRepsMax": 12,
        "restSeconds": 90
      },
      {
        "exerciseId": "f7e646dc-93e7-5251-8fc5-901959e91126",
        "targetSets": 3,
        "targetRepsMin": 8,
        "targetRepsMax": 10,
        "restSeconds": 120
      },
      {
        "exerciseId": "8dd94d51-5bb3-5738-9fb0-5e5fd51918d4",
        "targetSets": 3,
        "targetRepsMin": 10,
        "targetRepsMax": 15,
        "restSeconds": 60
      }
    ]
  },
  {
    "slug": "upper-lower-upper",
    "name": "Oberkörper (Upper/Lower)",
    "goal": "Hypertrophie · Oberkörper-Tag",
    "exercises": [
      {
        "exerciseId": "52b93346-35c6-5d9f-98c9-aee8761fa247",
        "targetSets": 4,
        "targetRepsMin": 6,
        "targetRepsMax": 10,
        "restSeconds": 120
      },
      {
        "exerciseId": "834aea33-7376-5eee-b0e7-cbd68e078f46",
        "targetSets": 4,
        "targetRepsMin": 6,
        "targetRepsMax": 10,
        "restSeconds": 120
      },
      {
        "exerciseId": "2beaf071-2c8b-589b-8860-10b51132081b",
        "targetSets": 3,
        "targetRepsMin": 8,
        "targetRepsMax": 12,
        "restSeconds": 90
      },
      {
        "exerciseId": "91f84555-62af-509e-ba6c-321a290717d9",
        "targetSets": 3,
        "targetRepsMin": 10,
        "targetRepsMax": 12,
        "restSeconds": 90
      },
      {
        "exerciseId": "963bea93-8fd7-55d1-b5f5-1c867bfaf151",
        "targetSets": 3,
        "targetRepsMin": 10,
        "targetRepsMax": 15,
        "restSeconds": 60
      },
      {
        "exerciseId": "423dc489-791c-50af-bde3-6b6a1d107b30",
        "targetSets": 3,
        "targetRepsMin": 10,
        "targetRepsMax": 15,
        "restSeconds": 60
      }
    ]
  },
  {
    "slug": "upper-lower-lower",
    "name": "Unterkörper (Upper/Lower)",
    "goal": "Hypertrophie · Bein-Tag",
    "exercises": [
      {
        "exerciseId": "37609db7-83e0-54f4-b006-eae02dcbb958",
        "targetSets": 4,
        "targetRepsMin": 6,
        "targetRepsMax": 10,
        "restSeconds": 150
      },
      {
        "exerciseId": "f7e646dc-93e7-5251-8fc5-901959e91126",
        "targetSets": 3,
        "targetRepsMin": 8,
        "targetRepsMax": 10,
        "restSeconds": 120
      },
      {
        "exerciseId": "a5761427-9601-57de-b901-df1a3dae829d",
        "targetSets": 3,
        "targetRepsMin": 10,
        "targetRepsMax": 12,
        "restSeconds": 90
      },
      {
        "exerciseId": "966f26dd-98f2-5180-b3f1-2c94242fd23d",
        "targetSets": 3,
        "targetRepsMin": 10,
        "targetRepsMax": 12,
        "restSeconds": 75
      },
      {
        "exerciseId": "3dfa2391-6d26-56cc-80ca-3a79522c2d26",
        "targetSets": 3,
        "targetRepsMin": 12,
        "targetRepsMax": 15,
        "restSeconds": 60
      },
      {
        "exerciseId": "a8fb5710-6bcc-5cab-96e2-141b06cb9cac",
        "targetSets": 4,
        "targetRepsMin": 12,
        "targetRepsMax": 20,
        "restSeconds": 45
      }
    ]
  },
  {
    "slug": "ppl-push",
    "name": "Push (Push/Pull/Legs)",
    "goal": "Hypertrophie · Drücken",
    "exercises": [
      {
        "exerciseId": "52b93346-35c6-5d9f-98c9-aee8761fa247",
        "targetSets": 4,
        "targetRepsMin": 6,
        "targetRepsMax": 10,
        "restSeconds": 120
      },
      {
        "exerciseId": "52e90514-ef77-51bc-9132-9fe76d719292",
        "targetSets": 3,
        "targetRepsMin": 8,
        "targetRepsMax": 12,
        "restSeconds": 90
      },
      {
        "exerciseId": "2beaf071-2c8b-589b-8860-10b51132081b",
        "targetSets": 3,
        "targetRepsMin": 8,
        "targetRepsMax": 12,
        "restSeconds": 90
      },
      {
        "exerciseId": "89f8c5bd-b4f5-5240-bbde-02da06af53ba",
        "targetSets": 3,
        "targetRepsMin": 12,
        "targetRepsMax": 15,
        "restSeconds": 45
      },
      {
        "exerciseId": "423dc489-791c-50af-bde3-6b6a1d107b30",
        "targetSets": 3,
        "targetRepsMin": 10,
        "targetRepsMax": 15,
        "restSeconds": 60
      }
    ]
  },
  {
    "slug": "ppl-pull",
    "name": "Pull (Push/Pull/Legs)",
    "goal": "Hypertrophie · Ziehen",
    "exercises": [
      {
        "exerciseId": "82f0a75a-d8cc-5bd4-adf1-f05964bfcb68",
        "targetSets": 3,
        "targetRepsMin": 5,
        "targetRepsMax": 8,
        "restSeconds": 150
      },
      {
        "exerciseId": "834aea33-7376-5eee-b0e7-cbd68e078f46",
        "targetSets": 4,
        "targetRepsMin": 6,
        "targetRepsMax": 10,
        "restSeconds": 120
      },
      {
        "exerciseId": "91f84555-62af-509e-ba6c-321a290717d9",
        "targetSets": 3,
        "targetRepsMin": 10,
        "targetRepsMax": 12,
        "restSeconds": 90
      },
      {
        "exerciseId": "5586bc7d-5032-5670-8fc3-277bfa501ec7",
        "targetSets": 3,
        "targetRepsMin": 12,
        "targetRepsMax": 15,
        "restSeconds": 60
      },
      {
        "exerciseId": "71ee078e-c339-53da-9422-cb18875e39fe",
        "targetSets": 3,
        "targetRepsMin": 8,
        "targetRepsMax": 12,
        "restSeconds": 60
      }
    ]
  },
  {
    "slug": "ppl-legs",
    "name": "Beine (Push/Pull/Legs)",
    "goal": "Hypertrophie · Beine",
    "exercises": [
      {
        "exerciseId": "37609db7-83e0-54f4-b006-eae02dcbb958",
        "targetSets": 4,
        "targetRepsMin": 6,
        "targetRepsMax": 10,
        "restSeconds": 150
      },
      {
        "exerciseId": "a5761427-9601-57de-b901-df1a3dae829d",
        "targetSets": 3,
        "targetRepsMin": 10,
        "targetRepsMax": 12,
        "restSeconds": 90
      },
      {
        "exerciseId": "f7e646dc-93e7-5251-8fc5-901959e91126",
        "targetSets": 3,
        "targetRepsMin": 8,
        "targetRepsMax": 10,
        "restSeconds": 120
      },
      {
        "exerciseId": "3dfa2391-6d26-56cc-80ca-3a79522c2d26",
        "targetSets": 3,
        "targetRepsMin": 12,
        "targetRepsMax": 15,
        "restSeconds": 60
      },
      {
        "exerciseId": "966f26dd-98f2-5180-b3f1-2c94242fd23d",
        "targetSets": 3,
        "targetRepsMin": 10,
        "targetRepsMax": 12,
        "restSeconds": 75
      },
      {
        "exerciseId": "a8fb5710-6bcc-5cab-96e2-141b06cb9cac",
        "targetSets": 4,
        "targetRepsMin": 12,
        "targetRepsMax": 20,
        "restSeconds": 45
      }
    ]
  },
  {
    "slug": "strength-5x5-a",
    "name": "5×5 Kraft A",
    "goal": "Maximalkraft · Ganzkörper A",
    "exercises": [
      {
        "exerciseId": "37609db7-83e0-54f4-b006-eae02dcbb958",
        "targetSets": 5,
        "targetRepsMin": 5,
        "targetRepsMax": 5,
        "restSeconds": 180
      },
      {
        "exerciseId": "52b93346-35c6-5d9f-98c9-aee8761fa247",
        "targetSets": 5,
        "targetRepsMin": 5,
        "targetRepsMax": 5,
        "restSeconds": 180
      },
      {
        "exerciseId": "834aea33-7376-5eee-b0e7-cbd68e078f46",
        "targetSets": 5,
        "targetRepsMin": 5,
        "targetRepsMax": 5,
        "restSeconds": 180
      }
    ]
  },
  {
    "slug": "strength-5x5-b",
    "name": "5×5 Kraft B",
    "goal": "Maximalkraft · Ganzkörper B",
    "exercises": [
      {
        "exerciseId": "37609db7-83e0-54f4-b006-eae02dcbb958",
        "targetSets": 5,
        "targetRepsMin": 5,
        "targetRepsMax": 5,
        "restSeconds": 180
      },
      {
        "exerciseId": "16d68739-9f92-5af9-968a-cc3b0a5843eb",
        "targetSets": 5,
        "targetRepsMin": 5,
        "targetRepsMax": 5,
        "restSeconds": 180
      },
      {
        "exerciseId": "82f0a75a-d8cc-5bd4-adf1-f05964bfcb68",
        "targetSets": 1,
        "targetRepsMin": 5,
        "targetRepsMax": 5,
        "restSeconds": 240
      }
    ]
  }
];
