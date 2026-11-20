import {expect,it} from "vitest";
import {local3060SamplingOptions} from "@/lib/workers/qwenClusterRouter";
it("passes fresh enhancement seeds and level temperature through the dedicated GPU transport",()=>{
 expect(local3060SamplingOptions({seed:123,temperature:.7})).toEqual({seed:123,temperature:.7});
 expect(local3060SamplingOptions({seed:456,temperature:.8})).toEqual({seed:456,temperature:.8});
});
it("retains default sampling for other local callers and refuses context or hardware overrides",()=>{
 expect(local3060SamplingOptions()).toEqual({temperature:.35});
 expect(local3060SamplingOptions({seed:-1,temperature:100,num_ctx:999999,num_gpu:0})).toEqual({temperature:1.2});
 expect(local3060SamplingOptions({seed:"123",temperature:NaN})).toEqual({temperature:.35});
});
