import { defineEventHandler } from 'h3'
import { getAltcha } from '../../utils/altcha'

// Public endpoint: gives the widget a new ALTCHA challenge to solve before submitting.
export default defineEventHandler(async (event) => {
  const altcha = await getAltcha()
  return altcha.challengeHandler(event)
})
