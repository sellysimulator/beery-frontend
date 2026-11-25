import { useEffect } from 'react'
import { applyProps, useThree } from '@react-three/fiber'

/** The hall's own lens, and the wider one that shows a readable part of it on
 *  an upright screen. */
const FOV = { wide: 72, upright: 90 } as const

/**
 * On a phone, widens the lens while the screen is upright. The hall's 72° is
 * vertical and set for a wide screen: at 390 × 714 it leaves 43° across, and a
 * role sign filled the width of the phone.
 */
export function PhoneLens(): null {
  const camera = useThree((state) => state.camera)
  const upright = useThree((state) => state.size.height > state.size.width)

  useEffect(() => {
    applyProps(camera, { fov: upright ? FOV.upright : FOV.wide })
    camera.updateProjectionMatrix()
    return () => {
      applyProps(camera, { fov: FOV.wide })
      camera.updateProjectionMatrix()
    }
  }, [camera, upright])

  return null
}

export default PhoneLens
