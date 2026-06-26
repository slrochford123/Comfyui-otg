# General Gallery Exclusion Policy v36bp3a

Creation/upload work areas must not save generated candidates into the general Gallery by default.

Applies to:

- Characters tab
- Character Builder
- standard character upload
- freeform character upload
- Background Studio
- background creation
- background upload

Allowed persistence:

- selected character card / workflow image
- derived background-removed default character profile image
- saved character metadata/card
- selected background card / background plate
- saved background metadata/card

Not allowed by default:

- unused Character Builder outputs in general Gallery
- unused Background Studio candidates in general Gallery
- upload intermediates in general Gallery
- generated candidate batches in general Gallery

Orientation rules:

- Standard character creation with Z Image Turbo should default to portrait.
- Freeform character creation must let the user choose portrait or landscape.
- Upload flows should preserve source orientation unless the user explicitly chooses crop/conversion.
- Background Studio should not be forced to portrait; backgrounds may be landscape, portrait, square, or panorama depending on the selected background task.

Storyboard workflow rule:

- character workflow input uses the original selected character card image.
- character/profile display uses the background-removed default character image when available.
- background workflow input uses the selected saved background card/plate image.

Cleanup rule:

- unreferenced generated candidates may be moved into patch backup storage instead of permanently deleted.
