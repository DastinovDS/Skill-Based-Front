<script lang="ts">
  // A screen that throws while it renders: the `crash` dev scene puts it under the CrashGuard.
  throw new Error('dev scene: the screen broke');
</script>
