import test from 'node:test';
import assert from 'node:assert/strict';
import {loginInput,newPassword} from '../../src/server/validation';

test('new and login passwords require 5 to 128 characters',()=>{
 assert.equal(newPassword.safeParse('abcde').success,true);
 assert.equal(newPassword.safeParse('abcd').success,false);
 assert.equal(newPassword.safeParse('x'.repeat(128)).success,true);
 assert.equal(newPassword.safeParse('x'.repeat(129)).success,false);

 assert.equal(loginInput.safeParse({username:'tester',password:'abcde'}).success,true);
 assert.equal(loginInput.safeParse({username:'tester',password:'abcd'}).success,false);
});
